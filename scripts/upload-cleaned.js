// Bulk-upload a directory of product PNGs to Cloudinary, overwriting existing
// public_ids and invalidating the CDN cache so new versions show immediately.
// The public_id is the filename without extension, so re-running with a fixed
// image replaces the old one in place.
//
//   node scripts/upload-cleaned.js <dir-with-pngs>
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { cloudinary, isConfigured, FOLDER } = require('../cloudinary');

const SRC = process.argv[2];

async function main() {
  if (!isConfigured) {
    console.error('❌ Cloudinary not configured (.env CLOUDINARY_*).');
    process.exit(1);
  }
  if (!SRC || !fs.existsSync(SRC)) {
    console.error('❌ Pass a directory of cleaned PNGs: node scripts/upload-cleaned.js <dir>');
    process.exit(1);
  }

  const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.png'));
  console.log(`Uploading ${files.length} cleaned image(s) to "${FOLDER}" (overwrite + invalidate)…\n`);

  let ok = 0, failed = 0;
  for (const file of files) {
    const publicId = file.replace(/\.[^.]+$/, ''); // raf.png -> raf
    try {
      const res = await cloudinary.uploader.upload(path.join(SRC, file), {
        folder: FOLDER,
        public_id: publicId,
        overwrite: true,
        invalidate: true,
        resource_type: 'image',
      });
      console.log(`  ✅ ${file} → ${res.secure_url}`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${file} — ${err.message}`);
      failed++;
    }
  }
  console.log(`\nDone. ${ok} uploaded, ${failed} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
