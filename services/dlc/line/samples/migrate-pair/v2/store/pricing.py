"""Pricing rules of v2."""

DISCOUNT_RATE = 0.05        # orders above 100 get 5 percent off
DISCOUNT_FROM = 100


def compute_total(book):
    subtotal = sum(i["price"] for i in book["items"])
    if subtotal > DISCOUNT_FROM:
        subtotal = subtotal * (1 - DISCOUNT_RATE)
    return round(subtotal, 2)
