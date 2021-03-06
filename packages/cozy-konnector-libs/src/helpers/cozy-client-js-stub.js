const fs = require('fs')
const path = require('path')
const log = require('cozy-logger').namespace('cozy-client-js-stub')
const mimetypes = require('mime-types')
const low = require('lowdb')
const lodashId = require('lodash-id')
const FileSync = require('lowdb/adapters/FileSync')
const rawBody = require('raw-body')

const rootPath = JSON.parse(
  process.env.COZY_FIELDS || '{"folder_to_save": "."}'
).folder_to_save

let db = setUpDb()

function setDefaults(doctype) {
  const defaults = {}
  defaults[doctype] = []
  db.defaults(defaults).write()
}

module.exports = {
  _setDb(newDb) {
    db = newDb
  },
  fetchJSON() {
    return Promise.resolve({
      rows: []
    })
  },
  data: {
    create(doctype, item) {
      setDefaults(doctype)
      const doc = db
        .get(doctype)
        .insert(item)
        .write()

      return Promise.resolve(doc)
    },
    update(doctype, doc, changes) {
      setDefaults(doctype)
      db.updateById(doc._id, changes).write()
      return Promise.resolve(doc)
    },
    updateAttributes(doctype, id, attrs) {
      setDefaults(doctype)
      const doc = db
        .get(doctype)
        .updateById(id, attrs)
        .write()
      return Promise.resolve(doc)
    },
    defineIndex(doctype) {
      return Promise.resolve({ doctype })
    },
    query(index, options) {
      // this stub only supposes that there are keys defined in options.selectors
      // this is only needed by the hydrateAndFilter function
      // supporting all mango selectors is not planned here
      const { doctype } = index
      setDefaults(doctype)
      const { selector } = options
      const keys = Object.keys(selector)
      let result = db
        .get(doctype)
        .filter(doc => keys.every(key => doc[key]))
        .value()

      if (options.wholeResponse) {
        result = { docs: result }
      }
      return Promise.resolve(result)
    },
    findAll(doctype) {
      setDefaults(doctype)
      return Promise.resolve(db.get(doctype).value())
    },
    delete(doctype, doc) {
      setDefaults(doctype)
      const result = db
        .get(doctype)
        .removeById(doc._id)
        .write()
      return Promise.resolve(result)
    },
    find(doctype, id) {
      setDefaults(doctype)
      // exeption for "io.cozy.accounts" doctype where we return konnector-dev-config.json content
      let result = null
      if (doctype === 'io.cozy.accounts') {
        const configPath = path.resolve('konnector-dev-config.json')
        const config = JSON.parse(fs.readFileSync(configPath))
        result = { auth: config.fields }
      } else {
        result = db
          .get(doctype)
          .getById(id)
          .value()
      }
      return Promise.resolve(result)
    },
    listReferencedFiles() {
      return Promise.resolve([])
    },
    addReferencedFiles() {
      return Promise.resolve({})
    }
  },
  files: {
    statByPath(pathToCheck) {
      // check this path in .
      return new Promise((resolve, reject) => {
        log('debug', `Checking if ${pathToCheck} exists`)
        if (pathToCheck === '/') return resolve({ _id: '.' })
        const realpath = path.join(rootPath, pathToCheck)
        log('info', realpath, 'realpath')
        log('debug', `Real path : ${realpath}`)
        if (fs.existsSync(realpath)) {
          const extension = path.extname(pathToCheck).substr(1)
          resolve({
            _id: removeFirstSlash(pathToCheck),
            attributes: {
              mime: mimetypes.lookup(extension),
              name: pathToCheck
            }
          })
        } else {
          const err = new Error(`${pathToCheck} does not exist`)
          err.status = 404
          reject(err)
        }
      })
    },
    statById() {
      // just return the / path for dev purpose
      return Promise.resolve({ attributes: { path: '/' } })
    },
    create(file, options) {
      return new Promise((resolve, reject) => {
        log('debug', `Creating new file ${options.name}`)
        const finalPath = path.join(rootPath, options.dirID, options.name)
        log('debug', `Real path : ${finalPath}`)
        let writeStream = fs.createWriteStream(finalPath)
        file.pipe(writeStream)

        file.on('end', () => {
          log('info', `File ${finalPath} created`)
          const extension = path.extname(options.name).substr(1)
          resolve({
            _id: options.name,
            attributes: {
              mime: mimetypes.lookup(extension),
              name: options.name
            }
          })
        })

        writeStream.on('error', err => {
          log('warn', `Error : ${err} while trying to write file`)
          reject(new Error(err))
        })
      })
    },
    createDirectory(options) {
      return new Promise(resolve => {
        log('info', `Creating new directory ${options.name}`)
        const finalPath = path.join(rootPath, options.dirID, options.name)
        const returnPath = path.join(options.dirID, options.name)
        log('info', `Real path : ${finalPath}`)
        fs.mkdirSync(finalPath)
        resolve({ _id: returnPath, path: returnPath })
      })
    },
    downloadByPath(filePath) {
      return this.downloadById(filePath)
    },
    downloadById(fileId) {
      const realpath = path.join(rootPath, fileId)
      const stream = fs.createReadStream(realpath)
      return {
        body: stream,
        buffer: () => rawBody(stream)
      }
    }
  }
}

function setUpDb() {
  let DUMP_PATH = 'importedData.json'
  const KONNECTOR_DEV_CONFIG_PATH = path.resolve('konnector-dev-config.json')
  if (fs.existsSync(KONNECTOR_DEV_CONFIG_PATH)) {
    const KONNECTOR_DEV_CONFIG = JSON.parse(
      fs.readFileSync(KONNECTOR_DEV_CONFIG_PATH, 'utf-8')
    )
    DUMP_PATH = path.join(
      KONNECTOR_DEV_CONFIG.fields.folderPath || rootPath,
      DUMP_PATH
    )
  }

  const db = low(new FileSync(DUMP_PATH))
  db._.mixin(lodashId)
  db._.id = '_id'
  return db
}

function removeFirstSlash(pathToCheck) {
  if (pathToCheck[0] === '/') {
    return pathToCheck.substr(1)
  }
  return pathToCheck
}
