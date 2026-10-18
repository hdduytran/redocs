# System context

> TODO(owner): Describe the system as a black box: its users, the external systems it talks to, and the main capabilities.

Recommended content:

1. One paragraph that a new engineer can read in a minute.
2. An architecture diagram embedded from archify:

   ```text
   redocs embed <book> archify system-context --spec system-context.json --type architecture
   ```

   then reference it on this page with a `redocs-embed` block.
3. A short list of the entities that matter most, written as references such as `[[svc:example]]`
   once they exist in `entities/`.
