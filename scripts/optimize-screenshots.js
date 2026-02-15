/**
 * Optimize screenshots for GitHub - resize and compress to reduce repo size.
 * Run: node scripts/optimize-screenshots.js
 * Requires: npm install sharp --save-dev
 */
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = path.join(__dirname, '..', 'public', 'Screenshots');
const MAX_WIDTH = 1200;
const QUALITY = 80;

async function optimize() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.log('Installing sharp... Run: npm install sharp --save-dev');
    process.exit(1);
  }

  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    console.log('No Screenshots folder found.');
    return;
  }

  const files = fs.readdirSync(SCREENSHOTS_DIR)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

  if (files.length === 0) {
    console.log('No images to optimize.');
    return;
  }

  console.log(`Optimizing ${files.length} image(s)...`);
  let saved = 0;

  for (const file of files) {
    const inputPath = path.join(SCREENSHOTS_DIR, file);
    const ext = path.extname(file).toLowerCase();

    try {
      const meta = await sharp(inputPath).metadata();
      const needsResize = meta.width > MAX_WIDTH;
      let pipeline = sharp(inputPath);

      if (needsResize) {
        pipeline = pipeline.resize(MAX_WIDTH, null, { withoutEnlargement: true });
      }

      const origSize = fs.statSync(inputPath).size;
      const tempPath = inputPath + '.tmp';

      if (ext === '.png') {
        await pipeline.png({ compressionLevel: 9 }).toFile(tempPath);
      } else {
        await pipeline.jpeg({ quality: QUALITY }).toFile(tempPath);
      }

      const newSize = fs.statSync(tempPath).size;
      if (newSize < origSize) {
        fs.renameSync(tempPath, inputPath);
        saved += origSize - newSize;
        console.log(`  ${file} (${(origSize/1024).toFixed(1)}KB -> ${(newSize/1024).toFixed(1)}KB)`);
      } else {
        fs.unlinkSync(tempPath);
        console.log(`  ${file} (kept original)`);
      }
    } catch (err) {
      console.error(`  ${file}: ${err.message}`);
    }
  }

  if (saved > 0) {
    console.log(`\nSaved ${(saved / 1024).toFixed(1)} KB total.`);
  }
}

optimize().catch(e => { console.error(e); process.exit(1); });
