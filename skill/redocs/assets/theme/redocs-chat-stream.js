/* ReDocs chat streaming: incremental Server-Sent Events parsing and per-provider accumulators
 * that turn a streamed reply back into the same JSON shape a non-streamed reply has, so the
 * agent loop parses both the same way. Pure: no network, no DOM (redocs-chat-agent.js reads the
 * response body and feeds the text in). */
(function (root) {
  'use strict';

  /** Incremental SSE parser: feed(text) returns the complete events seen so far. */
  function createSseParser() {
    var buffer = '';
    function parseBlock(block) {
      var event = 'message';
      var data = [];
      block.split(/\r?\n/).forEach(function (line) {
        if (!line || line.charAt(0) === ':') return;
        var colon = line.indexOf(':');
        var field = colon < 0 ? line : line.slice(0, colon);
        var value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      });
      return data.length ? { event: event, data: data.join('\n') } : null;
    }
    return {
      feed: function (text) {
        buffer += text;
        var events = [];
        var match;
        var re = /\r?\n\r?\n/;
        while ((match = re.exec(buffer))) {
          var block = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          var ev = parseBlock(block);
          if (ev) events.push(ev);
        }
        return events;
      },
      flush: function () {
        var ev = buffer.trim() ? parseBlock(buffer) : null;
        buffer = '';
        return ev ? [ev] : [];
      },
    };
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /** OpenAI-compatible chat.completion.chunk stream -> {choices: [{message, finish_reason}]}. */
  function openAiAccumulator(onText) {
    var content = '';
    var calls = [];
    var finish = null;
    var usage = null;
    return {
      push: function (ev) {
        if (ev.data === '[DONE]') return;
        var json = parseJson(ev.data);
        if (!json) return;
        if (json.error) throw new Error('LLM stream error: ' + (json.error.message || JSON.stringify(json.error)));
        if (json.usage) usage = json.usage;
        var choice = json.choices && json.choices[0];
        if (!choice) return;
        var delta = choice.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          onText(delta.content);
        }
        (delta.tool_calls || []).forEach(function (tc, i) {
          var at = typeof tc.index === 'number' ? tc.index : i;
          var slot = calls[at] || (calls[at] = { id: '', type: 'function', function: { name: '', arguments: '' } });
          if (tc.id) slot.id = tc.id;
          if (tc.function && tc.function.name) slot.function.name += tc.function.name;
          if (tc.function && tc.function.arguments) slot.function.arguments += tc.function.arguments;
        });
        if (choice.finish_reason) finish = choice.finish_reason;
      },
      result: function () {
        var toolCalls = calls.filter(Boolean).map(function (c, i) {
          if (!c.id) c.id = 'call_' + i;
          return c;
        });
        var message = { role: 'assistant', content: content };
        if (toolCalls.length) message.tool_calls = toolCalls;
        return { choices: [{ message: message, finish_reason: finish }], usage: usage };
      },
    };
  }

  /** Anthropic Messages stream -> {content: [...blocks], stop_reason, usage}. */
  function anthropicAccumulator(onText) {
    var blocks = [];
    var stop = null;
    var usage = null;
    return {
      push: function (ev) {
        var json = parseJson(ev.data);
        if (!json) return;
        switch (json.type) {
          case 'message_start':
            usage = (json.message && json.message.usage) || null;
            break;
          case 'content_block_start': {
            var b = json.content_block || {};
            if (b.type === 'text') blocks[json.index] = { type: 'text', text: b.text || '' };
            else if (b.type === 'tool_use') blocks[json.index] = { type: 'tool_use', id: b.id, name: b.name, input: {}, _json: '' };
            break;
          }
          case 'content_block_delta': {
            var block = blocks[json.index];
            var d = json.delta || {};
            if (!block) break;
            if (d.type === 'text_delta' && d.text) {
              block.text += d.text;
              onText(d.text);
            } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
              block._json += d.partial_json;
            }
            break;
          }
          case 'content_block_stop': {
            var done = blocks[json.index];
            if (done && done.type === 'tool_use') {
              done.input = parseJson(done._json || '{}') || {};
              delete done._json;
            }
            break;
          }
          case 'message_delta':
            if (json.delta && json.delta.stop_reason) stop = json.delta.stop_reason;
            if (json.usage) usage = Object.assign({}, usage || {}, json.usage);
            break;
          case 'error':
            throw new Error('LLM stream error: ' + ((json.error && json.error.message) || 'unknown'));
          default:
            break;
        }
      },
      result: function () {
        return {
          content: blocks.filter(Boolean).map(function (b) {
            if (b.type === 'tool_use' && b._json !== undefined) {
              b.input = parseJson(b._json || '{}') || {};
              delete b._json;
            }
            return b;
          }),
          stop_reason: stop,
          usage: usage,
        };
      },
    };
  }

  root.RedocsChatStream = {
    createSseParser: createSseParser,
    accumulator: function (provider, onText) {
      return provider === 'anthropic' ? anthropicAccumulator(onText) : openAiAccumulator(onText);
    },
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
