// Acceptance test F1 of the cap-mini sample (what a test author writes for the node-cap stack).
const cds = require('@sap/cds')
const { POST, GET, expect } = cds.test(__dirname + '/../..')

describe('F1 books', () => {
  // trace: F1.C1 spec.md#L3-5
  test('F1.C1 creates a book', async () => {
    const { status } = await POST('/odata/v4/catalog/Books', { ID: 1, title: 'Dune', stock: 3 })
    expect(status).to.equal(201)
    const { data } = await GET('/odata/v4/catalog/Books(1)')
    expect(data.title).to.equal('Dune')
  })

  // trace: F1.C2 spec.md#L6-7
  test('F1.C2 rejects an empty title', async () => {
    await expect(POST('/odata/v4/catalog/Books', { ID: 2, title: ' ' })).to.be.rejectedWith(/title is required/)
  })
})
