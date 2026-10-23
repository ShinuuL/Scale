// Hook afterPack do electron-builder: grava os fuses no binario empacotado
// (antes da assinatura e do instalador).
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const name = packager.appInfo.productFilename;
  const exe =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${name}.app`)
      : electronPlatformName === 'win32'
        ? path.join(appOutDir, `${name}.exe`)
        : path.join(appOutDir, packager.executableName);

  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  console.log(`[desktop] fuses aplicados em ${exe}`);
};
