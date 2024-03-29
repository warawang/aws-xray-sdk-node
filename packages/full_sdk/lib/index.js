// Convenience file to require the SDK from the root of the repository
var AWSXRay = require('@wmp-sbd/aws-xray-sdk-core');
AWSXRay.express = require('@wmp-sbd/aws-xray-sdk-express');
AWSXRay.captureMySQL = require('@wmp-sbd/aws-xray-sdk-mysql');
AWSXRay.capturePostgres = require('@wmp-sbd/aws-xray-sdk-postgres');

var UNKNOWN = 'unknown';
var pkginfo = module.filename ? require('pkginfo') : function() {};
pkginfo(module);

(function () {
  var sdkData = AWSXRay.SegmentUtils.sdkData || { sdk: 'X-Ray for Node.js' };
  sdkData.sdk_version = (module.exports && module.exports.version) ? module.exports.version : UNKNOWN;
  sdkData.package = (module.exports && module.exports.name) ? module.exports.name : UNKNOWN;
  AWSXRay.SegmentUtils.setSDKData(sdkData);
})();

module.exports = AWSXRay;
