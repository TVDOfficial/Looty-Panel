const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

function generateSelfSignedCert() {
    const certPath = path.join(config.CERTS_DIR, 'server.crt');
    const keyPath = path.join(config.CERTS_DIR, 'server.key');

    // Check if certs already exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        logger.info('CERTS', 'SSL certificates already exist');
        return { certPath, keyPath };
    }

    logger.info('CERTS', 'Generating self-signed SSL certificate...');

    // Ensure certs directory exists
    if (!fs.existsSync(config.CERTS_DIR)) {
        fs.mkdirSync(config.CERTS_DIR, { recursive: true });
    }

    // Generate key pair
    const keys = forge.pki.rsa.generateKeyPair(2048);

    // Create certificate
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01' + Date.now().toString(16);
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    const attrs = [
        { name: 'commonName', value: 'Loot Panel' },
        { name: 'organizationName', value: 'Loot Panel Self-Signed' },
        { name: 'countryName', value: 'US' },
    ];
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    cert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' },
            ],
        },
    ]);

    // Self-sign
    cert.sign(keys.privateKey, forge.md.sha256.create());

    // Write to files
    const pemCert = forge.pki.certificateToPem(cert);
    const pemKey = forge.pki.privateKeyToPem(keys.privateKey);

    fs.writeFileSync(certPath, pemCert);
    fs.writeFileSync(keyPath, pemKey);

    logger.info('CERTS', 'Self-signed SSL certificate generated successfully');
    return { certPath, keyPath };
}

module.exports = { generateSelfSignedCert };
