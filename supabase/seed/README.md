# Seed data

Reference data (annual plans in SAR halalas and the 21 AI employee templates) is shipped as a
migration (`migrations/20260925000008_seed_reference_data.sql`) so every environment gets the
same trusted prices. No demo/fake business data is seeded.

To grant the platform super admin role, run `scripts/grant-super-admin.sql` in the SQL editor.
