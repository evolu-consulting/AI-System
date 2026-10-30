# migrate-estate: a feature migration whose v1 is an ESTATE of repositories

v1 (folder `v1/`, made into three git repositories by line/e2e/migrate_estate.py):
- `shop_db_order`   data layer of the order object (vanilla, tagged `vanilla`)
- `shop_srv_order`  service layer of the order object: commands add / total, discount rule (vanilla, tagged)
- `shop_srv_export` a repository only the customer has: CSV export (no `vanilla` tag -> customer custom)

v2: the single rewrite repository of samples/migrate-pair/v2.

"Add an item" is found in BOTH order repositories (the data layer stores it, the service layer exposes the
command): the per-repository scan finds it twice and the merge makes it one feature.
