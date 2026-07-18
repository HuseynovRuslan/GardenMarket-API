const { v2: cloudinary } = require('cloudinary');

const FOLDER = process.env.CLOUDINARY_FOLDER || 'gardenmarket';

const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (isConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// Upload a local file or buffer to the Cloudinary "gardenmarket" folder.
// `publicId` (optional) keeps uploads stable/overwritable (e.g. product slug).
// Returns the secure HTTPS URL of the uploaded image.
async function uploadImage(filePathOrBuffer, publicId, folder = FOLDER) {
  const opts = { folder, resource_type: 'image', overwrite: true };
  if (publicId) opts.public_id = publicId;

  if (Buffer.isBuffer(filePathOrBuffer)) {
    return new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(opts, (err, result) => (err ? reject(err) : resolve(result.secure_url)))
        .end(filePathOrBuffer);
    });
  }
  const result = await cloudinary.uploader.upload(filePathOrBuffer, opts);
  return result.secure_url;
}

// Delete an image by its Cloudinary URL (best-effort, only for our folder).
async function deleteImage(url) {
  if (!isConfigured || !url || !url.includes('res.cloudinary.com')) return;
  // Extract public_id incl. folder: .../upload/v123/gardenmarket/name.png -> gardenmarket/name
  const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
  if (!m) return;
  try {
    await cloudinary.uploader.destroy(m[1], { resource_type: 'image' });
  } catch (_) {
    /* best-effort */
  }
}

module.exports = { cloudinary, uploadImage, deleteImage, isConfigured, FOLDER };
