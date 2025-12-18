import type { OpenAPIV3, OpenAPIV3_1 } from 'openapi-types'
import OpenAPIClientAxios from 'openapi-client-axios'
import type { AxiosInstance } from 'axios'
import FormData from 'form-data'
import fs from 'fs'
import { Headers } from './polyfill-headers'
import { isFileUploadParameter } from '../openapi/file-upload'

export type HttpClientConfig = {
  baseUrl: string
  headers?: Record<string, string>
}

export type HttpClientResponse<T = any> = {
  data: T
  status: number
  headers: Headers
}

export class HttpClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: any,
    public headers?: Headers,
  ) {
    super(`${status} ${message}`)
    this.name = 'HttpClientError'
  }
}

export class HttpClient {
  private api: Promise<AxiosInstance>
  private client: OpenAPIClientAxios
  private openApiSpec: OpenAPIV3.Document | OpenAPIV3_1.Document
  private operationCache: Map<string, OpenAPIV3.OperationObject & { method: string; path: string }> = new Map()

  constructor(config: HttpClientConfig, openApiSpec: OpenAPIV3.Document | OpenAPIV3_1.Document) {
    this.openApiSpec = openApiSpec
    // @ts-expect-error
    this.client = new (OpenAPIClientAxios.default ?? OpenAPIClientAxios)({
      definition: openApiSpec,
      axiosConfigDefaults: {
        baseURL: config.baseUrl,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'notion-mcp-server',
          ...config.headers,
        },
      },
    })
    this.api = this.client.init()
  }

  /**
   * Look up an operation from the OpenAPI spec by operationId
   */
  getOperationById(operationId: string): (OpenAPIV3.OperationObject & { method: string; path: string }) | null {
    // Check cache first
    if (this.operationCache.has(operationId)) {
      return this.operationCache.get(operationId)!
    }

    // Search through paths
    const paths = this.openApiSpec.paths
    if (!paths) return null

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue
      const methods = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const
      for (const method of methods) {
        const operation = (pathItem as any)[method] as OpenAPIV3.OperationObject | undefined
        if (operation?.operationId === operationId) {
          const result = { ...operation, method, path }
          this.operationCache.set(operationId, result)
          return result
        }
      }
    }

    return null
  }

  private async prepareFileUpload(operation: OpenAPIV3.OperationObject, params: Record<string, any>): Promise<FormData | null> {
    const fileParams = isFileUploadParameter(operation)
    if (fileParams.length === 0) return null

    const formData = new FormData()

    // Handle file uploads
    for (const param of fileParams) {
      const filePath = params[param]
      if (!filePath) {
        throw new Error(`File path must be provided for parameter: ${param}`)
      }
      switch (typeof filePath) {
        case 'string':
          addFile(param, filePath)
          break
        case 'object':
          if(Array.isArray(filePath)) {
            let fileCount = 0
            for(const file of filePath) {
              addFile(param, file)
              fileCount++
            }
            break
          }
          //deliberate fallthrough
        default:
          throw new Error(`Unsupported file type: ${typeof filePath}`)
      }
      function addFile(name: string, filePath: string) {
          try {
            const fileStream = fs.createReadStream(filePath)
            formData.append(name, fileStream)
        } catch (error) {
          throw new Error(`Failed to read file at ${filePath}: ${error}`)
        }
      }
    }

    // Add non-file parameters to form data
    for (const [key, value] of Object.entries(params)) {
      if (!fileParams.includes(key)) {
        formData.append(key, value)
      }
    }

    return formData
  }

  /**
   * Execute an OpenAPI operation
   * If the operation object is minimal (just method, path, operationId), it will look up the full definition from the spec
   */
  async executeOperation<T = any>(
    operation: OpenAPIV3.OperationObject & { method: string; path: string },
    params: Record<string, any> = {},
  ): Promise<HttpClientResponse<T>> {
    const api = await this.api
    const operationId = operation.operationId
    if (!operationId) {
      throw new Error('Operation ID is required')
    }

    // If the operation is minimal (missing parameters/requestBody), look up the full definition
    // But preserve the original path and method (path may be pre-interpolated by custom tools)
    let fullOperation = operation
    if (!operation.parameters && !operation.requestBody) {
      const lookedUp = this.getOperationById(operationId)
      if (lookedUp) {
        fullOperation = {
          ...lookedUp,
          path: operation.path,  // Keep original path (may be interpolated)
          method: operation.method  // Keep original method
        }
      }
    }

    // Handle file uploads if present
    const formData = await this.prepareFileUpload(fullOperation, params)

    // Separate parameters based on their location
    const urlParameters: Record<string, any> = {}
    const bodyParams: Record<string, any> = formData || { ...params }

    // Extract path and query parameters based on operation definition
    if (fullOperation.parameters) {
      for (const param of fullOperation.parameters) {
        if ('name' in param && param.name && param.in) {
          if (param.in === 'path' || param.in === 'query') {
            if (params[param.name] !== undefined) {
              urlParameters[param.name] = params[param.name]
              if (!formData) {
                delete bodyParams[param.name]
              }
            }
          }
        }
      }
    }

    // Add all parameters as url parameters if there is no requestBody defined
    if (!fullOperation.requestBody && !formData) {
      for (const key in bodyParams) {
        if (bodyParams[key] !== undefined) {
          urlParameters[key] = bodyParams[key]
          delete bodyParams[key]
        }
      }
    }

    const operationFn = (api as any)[operationId]
    if (!operationFn) {
      throw new Error(`Operation ${operationId} not found`)
    }

    try {
      // If we have form data, we need to set the correct headers
      const hasBody = Object.keys(bodyParams).length > 0
      const headers = formData
        ? formData.getHeaders()
        : { ...(hasBody ? { 'Content-Type': 'application/json' } : { 'Content-Type': null }) }
      const requestConfig = {
        headers: {
          ...headers,
        },
      }

      // first argument is url parameters, second is body parameters
      const response = await operationFn(urlParameters, hasBody ? bodyParams : undefined, requestConfig)

      // Convert axios headers to Headers object
      const responseHeaders = new Headers()
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value) responseHeaders.append(key, value.toString())
      })

      return {
        data: response.data,
        status: response.status,
        headers: responseHeaders,
      }
    } catch (error: any) {
      if (error.response) {
        console.error('Error in http client', error)
        const headers = new Headers()
        Object.entries(error.response.headers).forEach(([key, value]) => {
          if (value) headers.append(key, value.toString())
        })

        throw new HttpClientError(error.response.statusText || 'Request failed', error.response.status, error.response.data, headers)
      }
      throw error
    }
  }

  /**
   * Make a raw HTTP request without needing an OpenAPI operation definition.
   * Useful for calling endpoints not in the OpenAPI spec.
   */
  async rawRequest<T = any>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    path: string,
    params: Record<string, any> = {},
    options: { headers?: Record<string, string> } = {}
  ): Promise<HttpClientResponse<T>> {
    const api = await this.api

    try {
      let response
      const config = {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      }

      // Interpolate path parameters
      let interpolatedPath = path
      const pathParams: string[] = []
      path.replace(/\{(\w+)\}/g, (_, param) => {
        pathParams.push(param)
        return ''
      })
      for (const param of pathParams) {
        if (params[param] !== undefined) {
          interpolatedPath = interpolatedPath.replace(`{${param}}`, encodeURIComponent(String(params[param])))
        }
      }

      // Separate query params from body params
      const bodyParams = { ...params }
      for (const param of pathParams) {
        delete bodyParams[param]
      }

      if (method === 'get' || method === 'delete') {
        response = await api.request({
          method,
          url: interpolatedPath,
          params: bodyParams,
          ...config
        })
      } else {
        response = await api.request({
          method,
          url: interpolatedPath,
          data: bodyParams,
          ...config
        })
      }

      const responseHeaders = new Headers()
      Object.entries(response.headers).forEach(([key, value]) => {
        if (value) responseHeaders.append(key, value.toString())
      })

      return {
        data: response.data,
        status: response.status,
        headers: responseHeaders,
      }
    } catch (error: any) {
      if (error.response) {
        const headers = new Headers()
        Object.entries(error.response.headers).forEach(([key, value]) => {
          if (value) headers.append(key, value.toString())
        })
        throw new HttpClientError(
          error.response.statusText || 'Request failed',
          error.response.status,
          error.response.data,
          headers
        )
      }
      throw error
    }
  }
}
