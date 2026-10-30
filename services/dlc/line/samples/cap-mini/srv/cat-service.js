const cds = require('@sap/cds')

module.exports = class CatalogService extends cds.ApplicationService {
  init () {
    this.before('CREATE', 'Books', req => {
      if (!req.data.title || !req.data.title.trim()) req.reject(400, 'title is required')
    })
    return super.init()
  }
}
