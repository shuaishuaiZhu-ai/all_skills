const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const FORMAT_KINDS = Object.freeze({
  svg: ["svg"],
  drawio: ["drawio"],
  both: ["svg", "drawio"],
});
const ALL_KINDS = Object.freeze(["svg", "drawio"]);
const INVALID_SEGMENT = /[<>:"/\\|?*\x00-\x1f]/;

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function validateSegment(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value === "." || value === "..") {
    throw new Error(`${label} must be a non-blank single path segment`);
  }
  if (
    INVALID_SEGMENT.test(value) ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a safe single path segment`);
  }
  return value;
}

function normalizeRoot(outDir) {
  if (typeof outDir !== "string" || outDir.trim() === "") {
    throw new Error("outDir must be a non-blank path");
  }
  return path.resolve(outDir);
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveWithinRoot(root, candidate, label) {
  const resolved = path.resolve(candidate);
  if (!isWithinRoot(root, resolved)) {
    throw new Error(`${label} must stay within the intended root`);
  }
  return resolved;
}

function assertExistingPathWithinRoot(root, candidate, label) {
  const resolved = resolveWithinRoot(root, candidate, label);
  const realRoot = fs.realpathSync(root);
  const realCandidate = fs.realpathSync(resolved);
  if (!isWithinRoot(realRoot, realCandidate)) {
    throw new Error(`${label} must stay within the intended root`);
  }
  return resolved;
}

function artifactPath(root, baseName, suffix, kind) {
  return resolveWithinRoot(root, path.join(root, `${baseName}${suffix}.${kind}`), "artifact path");
}

function hasFamilyArtifact(root, baseName, suffix) {
  return ALL_KINDS.some((kind) => fs.existsSync(artifactPath(root, baseName, suffix, kind)));
}

function hasExistingFamily(root, baseName) {
  if (!fs.existsSync(root)) return false;
  return fs.readdirSync(root).some((name) => ALL_KINDS.some((kind) => (
    name === `${baseName}.${kind}` ||
    name === `${baseName}.generated.${kind}` ||
    /^\d+$/.test(name.slice(`${baseName}.generated-v`.length, -(`.${kind}`.length))) &&
      name.startsWith(`${baseName}.generated-v`) &&
      name.endsWith(`.${kind}`)
  )));
}

function suffixForVersion(version) {
  if (version === 0) return "";
  return version === 1 ? ".generated" : `.generated-v${version}`;
}

function stagingError(code, message, stagingRoot) {
  const error = new Error(message);
  error.code = code;
  error.path = stagingRoot;
  return error;
}

function createStagingRoot(outDir, runId) {
  const root = normalizeRoot(outDir);
  validateSegment(runId, "runId");
  fs.mkdirSync(root, { recursive: true });
  const stagingRoot = resolveWithinRoot(root, path.join(root, `.diagram-build-${runId}`), "staging path");
  try {
    const existing = fs.lstatSync(stagingRoot);
    if (existing.isSymbolicLink()) {
      throw stagingError("E_STAGING_UNSAFE", `Staging path must not be a symlink or junction: ${stagingRoot}`, stagingRoot);
    }
    throw stagingError("E_STAGING_EXISTS", `Staging path already exists: ${stagingRoot}`, stagingRoot);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    fs.mkdirSync(stagingRoot);
  } catch (error) {
    if (error.code === "EEXIST") {
      let existing;
      try {
        existing = fs.lstatSync(stagingRoot);
      } catch {
        throw error;
      }
      throw existing.isSymbolicLink()
        ? stagingError("E_STAGING_UNSAFE", `Staging path must not be a symlink or junction: ${stagingRoot}`, stagingRoot)
        : stagingError("E_STAGING_EXISTS", `Staging path already exists: ${stagingRoot}`, stagingRoot);
    }
    throw error;
  }
  return assertExistingPathWithinRoot(root, stagingRoot, "staging path");
}

function resolveDeliveryPlan(outDir, baseName, format) {
  const root = normalizeRoot(outDir);
  validateSegment(baseName, "baseName");
  const kinds = FORMAT_KINDS[format];
  if (!kinds) throw new Error(`Unsupported diagram format: ${format}`);

  let version = hasExistingFamily(root, baseName) ? 1 : 0;
  while (hasFamilyArtifact(root, baseName, suffixForVersion(version))) {
    version += 1;
  }
  const suffix = suffixForVersion(version);
  const authored = kinds.map((kind) => ({
    kind,
    path: artifactPath(root, baseName, suffix, kind),
    stagingName: `${baseName}.${kind}`,
  }));
  return {
    outDir: root,
    baseName,
    format,
    authored,
    temporary: [],
    reportPath: resolveWithinRoot(root, path.join(root, `${baseName}${suffix}.quality.json`), "report path"),
  };
}

function stagingPathFor(stagingRoot, plan, artifact) {
  const stagingName = artifact.stagingName || `${plan.baseName}.${artifact.kind}`;
  validateSegment(stagingName, "staged artifact name");
  return path.join(stagingRoot, stagingName);
}

function cleanupTemporaryPaths(tempPaths) {
  const failures = [];
  for (const tempPath of [...tempPaths].reverse()) {
    try {
      fs.unlinkSync(tempPath);
    } catch (error) {
      if (error.code !== "ENOENT") failures.push({ path: tempPath, error });
    }
  }
  return failures;
}

function creationFingerprint(filePath) {
  const stats = fs.statSync(filePath);
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    sha256: sha256File(filePath),
  };
}

function matchesCreationFingerprint(filePath, fingerprint) {
  const current = creationFingerprint(filePath);
  return current.dev === fingerprint.dev &&
    current.ino === fingerprint.ino &&
    current.size === fingerprint.size &&
    current.sha256 === fingerprint.sha256;
}

function promoteArtifacts(stagingRoot, plan) {
  let root;
  let sourceArtifacts;
  try {
    root = normalizeRoot(plan && plan.outDir);
    validateSegment(plan && plan.baseName, "baseName");
    if (!FORMAT_KINDS[plan && plan.format] || !Array.isArray(plan.authored)) {
      throw new Error("Invalid delivery plan");
    }
    const resolvedStagingRoot = assertExistingPathWithinRoot(root, stagingRoot, "staging root");
    sourceArtifacts = plan.authored.map((artifact) => {
      if (!artifact || !FORMAT_KINDS[plan.format].includes(artifact.kind)) {
        throw new Error("Invalid delivery artifact");
      }
      const destination = resolveWithinRoot(root, artifact.path, "artifact path");
      const sourcePath = assertExistingPathWithinRoot(
        resolvedStagingRoot,
        stagingPathFor(resolvedStagingRoot, plan, artifact),
        "staged artifact path",
      );
      return { destination, sourcePath };
    });
  } catch (error) {
    if (error.code === "ENOENT") return { code: "E_ARTIFACT_MISSING", path: error.path };
    return { code: "E_ARTIFACT_PLAN", error };
  }

  const missing = sourceArtifacts.find(({ sourcePath }) => !fs.existsSync(sourcePath));
  if (missing) return { code: "E_ARTIFACT_MISSING", path: missing.sourcePath };

  const existing = sourceArtifacts.find(({ destination }) => fs.existsSync(destination));
  if (existing) return { code: "E_ARTIFACT_EXISTS", path: existing.destination };

  const tempPaths = [];
  const producedArtifacts = [];
  try {
    for (const { destination, sourcePath } of sourceArtifacts) {
      const tempPath = resolveWithinRoot(
        root,
        path.join(path.dirname(destination), `.${path.basename(destination)}.tmp-${process.pid}-${crypto.randomUUID()}`),
        "promotion temporary path",
      );
      tempPaths.push(tempPath);
      fs.copyFileSync(sourcePath, tempPath, fs.constants.COPYFILE_EXCL);
    }

    for (const { destination } of sourceArtifacts) {
      if (fs.existsSync(destination)) {
        const error = new Error(`Artifact target appeared during promotion: ${destination}`);
        error.code = "E_ARTIFACT_EXISTS";
        error.path = destination;
        throw error;
      }
    }

    for (let index = 0; index < sourceArtifacts.length; index += 1) {
      const destination = sourceArtifacts[index].destination;
      const tempPath = tempPaths[index];
      try {
        fs.linkSync(tempPath, destination);
      } catch (error) {
        if (error.code === "EEXIST") {
          error.code = "E_ARTIFACT_EXISTS";
          error.path = destination;
        }
        throw error;
      }
      producedArtifacts.push({ path: destination, fingerprint: creationFingerprint(destination) });
      fs.unlinkSync(tempPath);
    }
  } catch (error) {
    const protectedPaths = [];
    for (const producedArtifact of [...producedArtifacts].reverse()) {
      try {
        if (matchesCreationFingerprint(producedArtifact.path, producedArtifact.fingerprint)) {
          fs.unlinkSync(producedArtifact.path);
        } else {
          protectedPaths.push(producedArtifact.path);
        }
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") protectedPaths.push(producedArtifact.path);
      }
    }
    const temporaryFailures = cleanupTemporaryPaths(tempPaths);
    if (protectedPaths.length > 0 || temporaryFailures.length > 0) {
      return {
        code: "E_ARTIFACT_ROLLBACK_INCOMPLETE",
        error,
        paths: [...protectedPaths, ...temporaryFailures.map((failure) => failure.path)],
      };
    }
    return error.code === "E_ARTIFACT_EXISTS"
      ? { code: "E_ARTIFACT_EXISTS", path: error.path }
      : { code: "E_ARTIFACT_PROMOTE", error };
  }
  return { code: "OK", plan };
}

function createQualityReport(input = {}) {
  const reportInput = input.input || {};
  const artifacts = input.artifacts || {};
  const reviews = input.reviews || {};
  return {
    schemaVersion: 1,
    status: input.status || "draft",
    requestedFormat: input.requestedFormat || "svg",
    requestedDeliverables: input.requestedDeliverables || [],
    input: { path: reportInput.path || "", sha256: reportInput.sha256 || "" },
    renderers: input.renderers || {},
    layoutAttempts: input.layoutAttempts || [],
    checks: input.checks || {},
    artifacts: { authored: artifacts.authored || [], temporary: artifacts.temporary || [] },
    errors: input.errors || [],
    reviews: {
      pageWidth: reviews.pageWidth || "pending",
      fullSize: reviews.fullSize || "pending",
      notes: reviews.notes || "",
    },
  };
}

function writeJsonAtomically(filePath, value) {
  const destination = path.resolve(filePath);
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(destination)}.tmp-${process.pid}-${crypto.randomUUID()}`);
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tempPath, destination);
  } finally {
    const failures = cleanupTemporaryPaths([tempPath]);
    if (failures.length > 0) {
      throw failures[0].error;
    }
  }
}

module.exports = {
  createQualityReport,
  createStagingRoot,
  promoteArtifacts,
  resolveDeliveryPlan,
  sha256File,
  writeJsonAtomically,
};
