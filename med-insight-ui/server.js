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

// ---------- Serve React frontend ----------
// Serve React build
app.use(express.static(path.join(__dirname, "build")));

// Catch-all: send index.html for any route not handled
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://3.90.51.95:${PORT}`)
);