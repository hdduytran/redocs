// `redocs ci <book> [--provider github|gitlab|both] [--force]`: write a release pipeline that, on a
// version tag, packages the book and attaches the zip to the release.
//
// The pipeline is deliberately dependency-free: it zips the COMMITTED publish folder (book.json
// publish.dir, default "site"), so CI needs neither Node nor the ReDocs skill — the 0.3.0 publish
// feature already keeps that folder built and in the repo. The zip is rooted at <id>-book/ so it
// matches `redocs pack` (readers unzip and open <id>-book/index.html). A guard step fails the build
// if the publish folder is missing, so a forgotten `redocs finalize` cannot ship an empty release.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadBook } from './load-book-from-directory.mjs';
import { publishDir } from './publish-site.mjs';
import { RedocsError } from './shared-helpers.mjs';

const PROVIDERS = new Set(['github', 'gitlab', 'both']);

/** GitHub Actions workflow: on a v* tag, zip the publish folder and attach it to the release. */
function githubWorkflow(bookId, publishRel) {
  const folder = `${bookId}-book`;
  return `# Release the ReDocs book as a zip on every version tag. Written by \`redocs ci\`.
# Push a tag like v1.0.0 (git tag v1.0.0 && git push origin v1.0.0) to trigger it.
name: ReDocs release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check the published site is committed
        run: |
          if [ ! -f "${publishRel}/index.html" ]; then
            echo "::error::${publishRel}/index.html is missing. Run 'redocs finalize .' and commit ${publishRel}/ before tagging."
            exit 1
          fi

      - name: Zip the book
        run: |
          rm -rf dist-release && mkdir -p dist-release
          cp -R "${publishRel}" "dist-release/${folder}"
          (cd dist-release && zip -r -X "../${folder}.zip" "${folder}")

      - name: Create the release and attach the zip
        uses: softprops/action-gh-release@v2
        with:
          files: ${folder}.zip
`;
}

/** GitLab CI: on a v* tag, zip the publish folder, upload it to the package registry, and release. */
function gitlabCi(bookId, publishRel) {
  const folder = `${bookId}-book`;
  return `# Release the ReDocs book as a zip on every version tag. Written by \`redocs ci\`.
# Push a tag like v1.0.0 (git tag v1.0.0 && git push origin v1.0.0) to trigger it.
stages:
  - release

redocs-release:
  stage: release
  image: registry.gitlab.com/gitlab-org/release-cli:latest
  rules:
    - if: '$CI_COMMIT_TAG =~ /^v/'
  variables:
    PACKAGE_URL: "\${CI_API_V4_URL}/projects/\${CI_PROJECT_ID}/packages/generic/${folder}/\${CI_COMMIT_TAG}/${folder}.zip"
  script:
    - |
      if [ ! -f "${publishRel}/index.html" ]; then
        echo "${publishRel}/index.html is missing. Run 'redocs finalize .' and commit ${publishRel}/ before tagging."
        exit 1
      fi
    - apk add --no-cache zip curl >/dev/null
    - rm -rf dist-release && mkdir -p dist-release
    - cp -R "${publishRel}" "dist-release/${folder}"
    - (cd dist-release && zip -r -X "../${folder}.zip" "${folder}")
    # Upload the zip to the project's generic package registry, then attach it to the release.
    - 'curl --fail --header "JOB-TOKEN: \${CI_JOB_TOKEN}" --upload-file "${folder}.zip" "\${PACKAGE_URL}"'
  release:
    tag_name: '\$CI_COMMIT_TAG'
    description: 'ReDocs book ${bookId} \$CI_COMMIT_TAG'
    assets:
      links:
        - name: '${folder}.zip'
          url: '\${PACKAGE_URL}'
`;
}

const FILES = {
  github: { path: '.github/workflows/redocs-release.yml', build: githubWorkflow },
  gitlab: { path: '.gitlab-ci.yml', build: gitlabCi },
};

/** Pure: the pipeline files (path + content) for a book id and publish folder. No disk I/O. */
export function ciPipelineFiles(bookId, publishRel, provider = 'both') {
  const chosen = provider === 'both' ? ['github', 'gitlab'] : [provider];
  return chosen.map((key) => ({ provider: key, path: FILES[key].path, content: FILES[key].build(bookId, publishRel) }));
}

/**
 * @param {{book: string, provider?: 'github'|'gitlab'|'both', force?: boolean}} options
 */
export function writeCiPipelines({ book: bookDir, provider = 'both', force = false }) {
  if (!PROVIDERS.has(provider)) {
    throw new RedocsError(`--provider must be one of github, gitlab, both (got '${provider}')`, { code: 'ERR_REDOCS_ARGS' });
  }
  const book = loadBook(bookDir);
  if (!book.config) throw new RedocsError('book.json is unreadable; run `redocs check` for details', { code: 'ERR_REDOCS_BOOK_JSON', diagnostics: book.diagnostics });
  const publishRel = publishDir(book.config) || 'site';
  const written = [];
  const skipped = [];
  for (const file of ciPipelineFiles(book.config.id, publishRel, provider)) {
    const target = path.join(book.root, file.path);
    if (existsSync(target) && !force) {
      skipped.push(file.path);
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    written.push(file.path);
  }
  const note = publishDir(book.config)
    ? ''
    : `\n  note: book.json has no "publish.dir"; the pipeline zips "site/". Set "publish": {"dir": "site"} and run \`redocs finalize\` so CI has a committed site to release.`;
  const lines = [`OK ci: ${written.length} pipeline file(s) written for ${provider} in ${book.root}`];
  if (written.length) lines.push(`  written: ${written.join(', ')}`);
  if (skipped.length) lines.push(`  skipped (exists, pass --force to overwrite): ${skipped.join(', ')}`);
  lines.push('  Commit the file(s) and the publish folder, then push a version tag (e.g. git tag v1.0.0 && git push origin v1.0.0).');
  return {
    ok: true,
    command: 'ci',
    summary: lines.join('\n') + note,
    provider,
    publishDir: publishRel,
    written,
    skipped,
  };
}
