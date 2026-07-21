import { runPipeline } from './server/pipeline.js';
import { downloadVideo } from './server/downloader.js';

async function test() {
  // Test 1: Just download
  console.log('=== Test 1: Download only ===');
  try {
    const result = await downloadVideo('https://www.youtube.com/watch?v=aOZ5A9r_sAw', (pct) => {});
    console.log('Download success:', result);
  } catch(e) {
    console.error('Download error:', e.message);
  }

  // Test 2: Full pipeline
  console.log('\n=== Test 2: Full pipeline ===');
  try {
    const result = await runPipeline(
      'https://www.youtube.com/watch?v=aOZ5A9r_sAw',
      (stage, progress, extra) => console.log('Progress:', stage, progress + '%'),
      'none'
    );
    console.log('Pipeline success:', result.length, 'clips');
  } catch(e) {
    console.error('Pipeline error:', e.message);
  }
}

test();