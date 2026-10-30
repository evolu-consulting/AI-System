# Add the buyer's tax code to sale contracts

A sale contract may carry `buyer_tax_code`. When it is given it must follow the legal rule for tax codes
(see the project's legal rules). An invalid code is refused with an error that names the field.
