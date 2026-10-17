"""Words of the business ledger: what can happen with a partner, and what each obligation is."""

# Partner events (index partner_events). Scoring reads only these; nothing else feeds a reputation.
PAID = "paid"                         # we paid a supplier instalment; days_late >= 0
RECEIVED = "received"                 # a customer paid us; days_late >= 0
POSTPONED = "postponed"               # "Khách hẹn lại": the due date moved at the partner's request
APPOINTMENT_KEPT = "appointment_kept"
APPOINTMENT_MISSED = "appointment_missed"
DELIVERED = "delivered"               # a supplier delivery; days_late >= 0
REMINDED = "reminded"                 # we had to remind the partner (counted by the "Đã nhắc" action only)
COMPLAINT = "complaint"
CKS_RENEWED = "cks_renewed"           # days_before_expiry (negative = renewed late), with_us
CKS_LAPSED = "cks_lapsed"             # let expire, or renewed elsewhere
MANUAL_ADJUST = "manual_adjust"       # delta in [-10, 10], note required
RATING = "rating"                     # a person's 0–100 on a criterion the owner added (criterion "custom:…", value)
OVERDUE = "overdue"                   # logged by the system the day after an instalment's due date passed undone;
                                      # due_date, party_late (the partner is the late one, not us)

EVENT_TYPES = (PAID, RECEIVED, POSTPONED, APPOINTMENT_KEPT, APPOINTMENT_MISSED, DELIVERED, REMINDED, COMPLAINT,
               CKS_RENEWED, CKS_LAPSED, MANUAL_ADJUST, RATING, OVERDUE)
SETTLED = (PAID, RECEIVED, DELIVERED)   # an instalment done: its lateness is known

# Who wrote an event: a person's click ("action"), the assistant on their behalf, or the app by itself.
SYSTEM_BY = "hệ thống"
# Recorded by a person from the assistant (the rest come from actions on obligations, CKS and the system).
MANUAL_TYPES = (APPOINTMENT_KEPT, APPOINTMENT_MISSED, DELIVERED, COMPLAINT, MANUAL_ADJUST)

CUSTOMER, SUPPLIER = "customer", "supplier"
ROLES = (CUSTOMER, SUPPLIER)

# Obligations (index obligations)
PAY, RECEIVE = "pay", "receive"                     # we pay a supplier / a customer pays us
PAYMENT, DELIVERY = "payment", "delivery"
OPEN, DONE, CANCELLED = "open", "done", "cancelled"
