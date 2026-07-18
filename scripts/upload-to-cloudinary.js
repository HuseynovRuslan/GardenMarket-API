// Migration: upload every local product photo (/uploads/*.png) to the
// Cloudinary "gardenmarket" folder and rewrite the dishes.image column to the
// hosted HTTPS URL, so the storefront loads photos from Cloudinary, not disk.
// Safe to re-run — it only picks up rows still pointing at /uploads/.
//
//   node scripts/upload-to-cloudinary.js
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { getDB, initDB } = require('../db/database');
const { uploadImage, isConfigured, FOLDER } = require('../cloudinary');

async function main() {
  if (!isConfigured) {
    console.error('❌ Cloudinary is not configured. Set CLOUDINARY_* vars in .env');
    process.exit(1);
  }

  initDB();
  const db = getDB();

  // Every dish still pointing at a local upload.
  const dishes = db
    .prepare("SELECT id, name, image FROM dishes WHERE image LIKE '/uploads/%'")
    .all();

  if (dishes.length === 0) {
    console.log('✅ No local /uploads images left to migrate.');
    return;
  }

  console.log(`Uploading ${dishes.length} image(s) to Cloudinary folder "${FOLDER}"…\n`);
  const update = db.prepare('UPDATE dishes SET image = ? WHERE id = ?');
  let ok = 0, missing = 0, failed = 0;

  for (const dish of dishes) {
    const fileName = path.basename(dish.image); // e.g. cappuccino.png
    const filePath = path.join(__dirname, '..', 'uploads', fileName);
    const publicId = fileName.replace(/\.[^.]+$/, ''); // cappuccino

    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠️  ${fileName} — file not found on disk, skipping`);
      missing++;
      continue;
    }

    try {
      const url = await uploadImage(filePath, publicId);
      update.run(url, dish.id);
      console.log(`  ✅ ${fileName} → ${url}`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ${fileName} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. ${ok} uploaded, ${missing} missing, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
