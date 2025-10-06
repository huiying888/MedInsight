// server.js
const express = require("express");
const cors = require("cors");
const aws = require("aws-sdk");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const BUCKET = process.env.AWS_BUCKET || "meddoc-raw";
const REGION = process.env.AWS_REGION || "us-east-1";
const PROCESSED_BUCKET = process.env.PROCESSED_BUCKET || "meddoc-processed";

aws.config.update({
  region: REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const s3 = new aws.S3();

// presign endpoint
app.post("/presign", async (req, res) => {
  const { fileName, fileType, folder } = req.body;
  const key = folder ? `${folder}/${fileName}` : fileName;

  const params = {
    Bucket: BUCKET,
    Key: key,
    ContentType: fileType,
    Expires: 3600*10, // very long expiration for testing
  };
  console.log("Generating presign for:", params);

  try {
    const url = await s3.getSignedUrlPromise("putObject", params);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cannot generate presigned URL" });
  }
});

// GET /summary?key=patients/SomeFile.docx
app.get("/summary", async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: "key is required" });
    const folder = key.includes("/") ? key.split("/")[0] : "";
    const base   = key.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
    const summaryKey = `summaries/${folder}/${base}.md`;
    const obj = await s3.getObject({ Bucket: PROCESSED_BUCKET, Key: summaryKey }).promise();
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.send(obj.Body);
  } catch (e) {
    return res.status(404).json({ error: "Summary not found" });
  }
});

// ---------- Serve React frontend ----------
// Serve React build
app.use(express.static(path.join(__dirname, "build")));

// Catch-all: send index.html for any route not handled
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://54.198.86.26:${PORT}`)
);