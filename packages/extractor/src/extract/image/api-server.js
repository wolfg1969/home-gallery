import request from 'request';

import Logger from '@home-gallery/logger'

const log = Logger('extractor.apiEntry');
import { through, parallel } from '@home-gallery/stream';

import { conditionalTask } from '../../stream/task.js';
import { sizeToImagePreviewSuffix } from './image-preview.js'

const ERROR_THRESHOLD = 5
const PUBLIC_API_SERVER = 'https://api.home-gallery.org'
const DOCUMENATION_URL = 'https://docs.home-gallery.org'

const getEntryFileBySuffixes = (storage, entry, suffixes) => suffixes.find(suffix => storage.hasEntryFile(entry, suffix));

export const apiServerEntry = (storage, {name, apiServerUrl, apiPath, imagePreviewSuffixes, entrySuffix, concurrent, timeout}) => {
  let currentErrors = 0;

  const test = entry => {
    if (currentErrors > ERROR_THRESHOLD) {
      return false;
    } else if (!getEntryFileBySuffixes(storage, entry, imagePreviewSuffixes) || storage.hasEntryFile(entry, entrySuffix)) {
      return false;
    } else if (entry.type === 'image' || entry.type === 'rawImage') {
      return true;
    } else {
      return false;
    }
  }

  const addError = () => {
    currentErrors++;
    if (currentErrors > ERROR_THRESHOLD) {
      log.warn(`Too many errors. Skip processing of ${name}`);
    }
  }

  const task = (entry, cb) =>{
    const t0 = Date.now();
    const imagePreviewSuffix = getEntryFileBySuffixes(storage, entry, imagePreviewSuffixes);
    storage.readEntryFile(entry, imagePreviewSuffix, (err, buffer) => {
      if (err) {
        log.warn(`Could not read image entry file ${imagePreviewSuffix} from ${entry}: ${err}. Skip ${name} for this entry`);
        return cb();
      }

      const url = `${apiServerUrl}${apiPath}`;
      const options = {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: buffer,
        encoding: null,
        timeout: timeout * 1000,
      }
      request(options, (err, res, body) => {
        if (err) {
          addError();
          log.warn(err, `Could not get ${name} of ${entry} from URL ${url}: ${err}`);
          return cb();
        } else if (res.statusCode < 100 || res.statusCode >= 300) {
          addError();
          log.error(err, `Could not get ${name} of ${entry} from URL ${url}: HTTP response code is ${res.statusCode}`);
          return cb();
        }
        storage.writeEntryFile(entry, entrySuffix, body, (err) => {
          if (err) {
            log.warn(err, `Could write ${name} of ${entry}: ${err}`);
          } else {
            if (currentErrors > 0) {
              currentErrors--;
            }
            log.debug(t0, `Fetched ${name} for ${entry}`);
          }
          cb();
        });
      })
    });
  }

  return parallel({task: conditionalTask(test, task), concurrent});
}

const noop = () => through((entry, _, cb) => cb(null, entry))

export const logPublicApiPrivacyHint = (config) => {
  const {url, timeout, concurrent} = config?.extractor?.apiServer

  if (url?.startsWith(PUBLIC_API_SERVER)) {
    log.warn(`You are using the public api server ${url}. Please read its documentation at ${DOCUMENATION_URL} for privacy concerns`)
  } else {
    log.debug(`Use api server ${url}`)
  }
  log.trace(`Use api server with ${concurrent} concurrent connections and timeout of ${timeout}s`)

  return noop()
}

const apiServerPreviewSizeFilter = size => size <= 800

const isDisabled = (config, feature) => {
  const disable = config?.extractor?.apiServer?.disable || []
  if (Array.isArray(disable)) {
    return disable.includes(feature)
  }
  return disable == feature
}

export const similarEmbeddings = (storage, common, config) => {
  if (isDisabled(config, 'similarDetection')) {
    log.info(`Disable similar detection`)
    return noop()
  }

  const apiServer = config.extractor.apiServer
  return apiServerEntry(storage, {
    name: 'similarity embeddings',
    apiServerUrl: apiServer.url,
    apiPath: '/embeddings',
    imagePreviewSuffixes: common.imagePreviewSizes.filter(apiServerPreviewSizeFilter).map(sizeToImagePreviewSuffix),
    entrySuffix: 'similarity-embeddings.json',
    concurrent: apiServer.concurrent,
    timeout: apiServer.timeout,
  })
}

export const objectDetection = (storage, common, config) => {
  if (isDisabled(config, 'objectDetection')) {
    log.info(`Disable object detection`)
    return noop()
  }

  const apiServer = config.extractor.apiServer
  return apiServerEntry(storage, {
    name: 'object detection',
    apiServerUrl: apiServer.url,
    apiPath: '/objects',
    imagePreviewSuffixes: common.imagePreviewSizes.filter(apiServerPreviewSizeFilter).map(sizeToImagePreviewSuffix),
    entrySuffix: 'objects.json',
    concurrent: apiServer.concurrent,
    timeout: apiServer.timeout,
  })
}

export const faceDetection = (storage, common, config) => {
  if (isDisabled(config, 'faceDetection')) {
    log.info(`Disable face detection`)
    return noop()
  }

  const apiServer = config.extractor.apiServer
  return apiServerEntry(storage, {
    name: 'face detection',
    apiServerUrl: apiServer.url,
    apiPath: '/faces',
    imagePreviewSuffixes: common.imagePreviewSizes.filter(apiServerPreviewSizeFilter).map(sizeToImagePreviewSuffix),
    entrySuffix: 'faces.json',
    concurrent: apiServer.concurrent,
    timeout: apiServer.timeout,
  })
}
