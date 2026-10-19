'use strict';

/**
 * Return old, unexpired GitHub Pages artifacts for deletion.
 * Fail closed if a Pages artifact has unusable metadata.
 */
function selectOldPagesArtifacts(artifacts, keep = 2) {
  if (!Array.isArray(artifacts) || !Number.isInteger(keep) || keep < 1) {
    throw new TypeError('Expected an artifact array and a positive keep count');
  }

  const pages = artifacts.filter((artifact) =>
    artifact?.name === 'github-pages' && artifact.expired !== true
  );

  for (const artifact of pages) {
    if (!Number.isSafeInteger(artifact.id) || artifact.id < 1 ||
        !Number.isFinite(Date.parse(artifact.created_at))) {
      throw new Error('Invalid GitHub Pages artifact metadata; refusing to delete');
    }
  }

  pages.sort((a, b) =>
    Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id
  );

  return pages.slice(keep);
}

module.exports = { selectOldPagesArtifacts };
