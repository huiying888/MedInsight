export default function Upload() {
  return (
    <section style={{ padding: 24 }}>
      <h2>Upload Documents</h2>
      <p>Drag-and-drop or choose files to send to your S3 bucket (coming soon).</p>
      <input type="file" multiple />
    </section>
  );
}
