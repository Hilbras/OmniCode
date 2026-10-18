for (const key of Object.keys(process.env)) {
  if (key.startsWith('OMNICODE_')) {
    delete process.env[key];
  }
}

process.env['OMNICODE_PERSISTENCE_MINIDB_READMODEL'] = 'false';
