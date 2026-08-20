/**
 * This file documents the plain-object shapes used by the SDK.
 *
 * The runtime package intentionally stays dependency-free and does not require
 * TypeScript. These typedefs make editor IntelliSense useful in JavaScript
 * projects that read JSDoc from ESM packages.
 */

/**
 * @typedef {Object<string, unknown>} JSONMap
 */

/**
 * @typedef {Object} ClientConfig
 * @property {string} [apiKey]
 * @property {string} [baseURL]
 * @property {string} [modelBaseURL]
 * @property {string} [llmBaseURL]
 * @property {string} [passthroughBaseURL]
 * @property {string} [billingBaseURL]
 * @property {string} [project]
 * @property {number} [timeout] Timeout in milliseconds.
 * @property {typeof fetch} [fetch] Custom fetch implementation.
 */


/**
 * @typedef {Object} PrechargeResponse
 * @property {PrechargeData} [data]
 * @property {string} status success or failed.
 */

/**
 * @typedef {Object} PrechargeData
 * @property {string} [billing_model]
 * @property {string|null} [cost]
 * @property {string} [currency]
 * @property {number} [discount]
 * @property {string} [hash]
 * @property {string} [model]
 * @property {string} [original_model]
 * @property {number} [sample_count]
 * @property {number} [updated_at]
 * @property {string} [reason]
 */

/**
 * @typedef {Object} ComfyUIInput
 * @property {string} field
 * @property {unknown} value
 * @property {string} [node_id]
 */

/**
 * @typedef {Object} ComfyUITemplateSpecsResponse
 * @property {string} type
 * @property {Array<Object>} templates Templates matching the requested template IDs.
 */

/**
 * @typedef {Object} StreamEvent
 * @property {string} event
 * @property {string|undefined} data
 * @property {boolean} done
 */

/**
 * @typedef {Object} PassthroughResponse
 * @property {number} statusCode
 * @property {Headers} headers
 * @property {Uint8Array} body
 * @property {() => string} text
 * @property {() => unknown} json
 */

export {};
