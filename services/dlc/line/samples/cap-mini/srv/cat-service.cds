using mini from '../db/schema';

service CatalogService {
  entity Books as projection on mini.Books;
}
