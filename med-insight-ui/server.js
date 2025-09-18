// server.js
const express = require("express");
const cors = require("cors");
const aws = require("aws-sdk");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const BUCKET = process.env.AWS_BUCKET || "meddoc-raw";
const REGION = process.env.AWS_REGION || "us-east-1";

aws.config.update({
  region: REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
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
    Expires: 60
  };

  try {
    const url = await s3.getSignedUrlPromise("putObject", params);
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Cannot generate presigned URL" });
  }
});

app.listen(5000, () => console.log("Server running on http://localhost:5000"));
