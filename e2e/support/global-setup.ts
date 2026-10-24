/*
 * Before the run: is there a Realtime Database emulator for the online specs? `npm run test:e2e` starts one and
 * says where (FIREBASE_DATABASE_EMULATOR_HOST); otherwise look for one started by hand on the usual port. Workers
 * inherit what is set here, and the online specs skip when it stays unset (fixtures.ts, needsEmulator).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) return;
  const host = '127.0.0.1:9000';
  try {
    // Any answer at all means it's up (the rules may well refuse an anonymous read)
    await fetch(`http://${host}/.json?ns=demo-tuktuk&shallow=true`, { signal: AbortSignal.timeout(2_000) });
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = host;
  } catch {
    console.log('No Realtime Database emulator on :9000: the online specs will be skipped (run npm run test:e2e).');
  }
}
