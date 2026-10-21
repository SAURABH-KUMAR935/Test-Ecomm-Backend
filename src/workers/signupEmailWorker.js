const connectDB = require('../config/db');
const { processSignupEmailQueue } = require('../utils/signupEmailQueue');

const POLL_INTERVAL_MS = 5000;
let stopping = false;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const run = async () => {
  await connectDB();
  console.info('Signup email worker started.');

  while (!stopping) {
    await processSignupEmailQueue(10);
    await sleep(POLL_INTERVAL_MS);
  }

  process.exit(0);
};

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

run().catch((error) => {
  console.error('Signup email worker stopped unexpectedly:', error);
  process.exitCode = 1;
});
