import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isIP } from 'node:net';

import forge from 'node-forge';

export interface CertAuthority {
  readonly certPem: string;
  readonly keyPem: string;
  readonly certPath: string;
}

export interface IssuedLeaf {
  readonly certPem: string;
  readonly keyPem: string;
}

const CA_CERT = 'ca.crt';
const CA_KEY = 'ca.key';
const LEAF_DAYS = 30;
const CA_DAYS = 3650;

export async function ensureCertAuthority(homeDir: string): Promise<CertAuthority> {
  const directory = join(homeDir, 'egress');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const certPath = join(directory, CA_CERT);
  const keyPath = join(directory, CA_KEY);
  try {
    const [certPem, keyPem] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
    return { certPem, keyPem, certPath };
  } catch {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = randomSerial();
    cert.validity.notBefore = new Date(Date.now() - 60_000);
    cert.validity.notAfter = new Date(Date.now() + CA_DAYS * 86_400_000);
    const subject = [
      { name: 'commonName', value: 'Omnicode Egress CA' },
      { name: 'organizationName', value: 'Omnicode' },
    ];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    await writeFile(keyPath, keyPem, { mode: 0o600 });
    await writeFile(certPath, certPem, { mode: 0o600 });
    return { certPem, keyPem, certPath };
  }
}

export function issueLeaf(ca: CertAuthority, host: string): IssuedLeaf {
  const caCert = forge.pki.certificateFromPem(ca.certPem);
  const caKey = forge.pki.privateKeyFromPem(ca.keyPem) as forge.pki.rsa.PrivateKey;
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerial();
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + LEAF_DAYS * 86_400_000);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNames =
    isIP(host) !== 0
      ? [{ type: 7, ip: host }]
      : [{ type: 2, value: host }];
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ]);
  cert.sign(caKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

function randomSerial(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}
