"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const os = require("os");

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CONVERT_TIMEOUT_MS = 60_000;

[UPLOAD_DIR, OUTPUT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function findLibreOffice() {
  const candidates = [];
  if (process.platform === "win32") {
    const programFiles = process.env["ProgramFiles"] || "C:\\Program Files";
    const programFiles86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    candidates.push(
      path.join(programFiles, "LibreOffice", "program", "soffice.exe"),
      path.join(programFiles86, "LibreOffice", "program", "soffice.exe"),
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/local/bin/soffice",
      "/usr/bin/soffice"
    );
  } else {
    candidates.push(
      "/usr/bin/soffice",
      "/usr/bin/libreoffice",
      "/usr/local/bin/soffice",
      "/usr/local/bin/libreoffice"
    );
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return null;
}

const LIBREOFFICE_BIN = findLibreOffice();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const safe = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.docx`;
      cb(null, safe);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== ".docx") {
      return cb(new Error("Hanya file .docx yang didukung."));
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.static(__dirname));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use("/output", express.static(OUTPUT_DIR));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    libreOffice: LIBREOFFICE_BIN ? "found" : "missing",
    libreOfficePath: LIBREOFFICE_BIN,
    platform: process.platform,
    uploadDir: UPLOAD_DIR,
    outputDir: OUTPUT_DIR,
  });
});

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function runLibreOffice(inputPath, outdir, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!LIBREOFFICE_BIN) {
      return reject(new Error("LibreOffice tidak ditemukan. Install LibreOffice terlebih dahulu."));
    }
    const args = [
      "--headless",
      "--norestore",
      "--nologo",
      "--nodefault",
      "--nofirststartwizard",
      "--convert-to",
      "pdf",
      "--outdir",
      outdir,
      inputPath,
    ];

    const child = execFile(LIBREOFFICE_BIN, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.killed && err.signal === "SIGTERM") {
          return reject(new Error(`Konversi timeout setelah ${Math.round(timeoutMs / 1000)} detik.`));
        }
        const stderrText = stderr ? stderr.toString().trim() : "";
        const stdoutText = stdout ? stdout.toString().trim() : "";
        const detail = stderrText || stdoutText || err.message;
        return reject(new Error(`LibreOffice gagal: ${detail}`));
      }
      resolve();
    });

    child.on("error", (err) => {
      reject(new Error(`Tidak dapat menjalankan LibreOffice: ${err.message}`));
    });
  });
}

app.post("/api/word-to-pdf", upload.single("file"), async (req, res) => {
  const tmpUploads = req.file ? [req.file.path] : [];
  let outputPdfPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "File tidak ditemukan." });
    }

    if (!LIBREOFFICE_BIN) {
      return res.status(503).json({
        error: "LibreOffice tidak terinstal di server. Hubungi administrator.",
      });
    }

    if (req.file.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `File terlalu besar. Maksimal ${MAX_FILE_BYTES / 1024 / 1024}MB.` });
    }

    await runLibreOffice(req.file.path, OUTPUT_DIR, CONVERT_TIMEOUT_MS);

    const expectedPdfName = req.file.filename.replace(/\.docx$/i, ".pdf");
    outputPdfPath = path.join(OUTPUT_DIR, expectedPdfName);

    if (!fs.existsSync(outputPdfPath)) {
      return res.status(500).json({ error: "PDF tidak dihasilkan oleh LibreOffice." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.file.originalname.replace(/\.docx$/i, ".pdf")}"`);

    const fileStream = fs.createReadStream(outputPdfPath);
    fileStream.on("end", () => safeUnlink(outputPdfPath));
    fileStream.on("error", () => safeUnlink(outputPdfPath));
    fileStream.pipe(res);
  } catch (err) {
    console.error("[/api/word-to-pdf]", err);
    safeUnlink(outputPdfPath);
    if (err.message && err.message.startsWith("Hanya file")) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes("timeout")) {
      return res.status(504).json({ error: err.message });
    }
    res.status(500).json({ error: err.message || "Gagal mengonversi file." });
  } finally {
    tmpUploads.forEach(safeUnlink);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `File terlalu besar. Maksimal ${MAX_FILE_BYTES / 1024 / 1024}MB.` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`LibreOffice: ${LIBREOFFICE_BIN || "NOT FOUND - install from https://www.libreoffice.org/"}`);
});
