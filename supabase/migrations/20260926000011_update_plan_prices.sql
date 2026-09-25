-- NEXUS Platform — 0011: updated annual prices (halalas = SAR × 100). Enterprise stays custom.
update public.subscription_plans set price_halalas = 99900 where code = 'starter';
update public.subscription_plans set price_halalas = 199900 where code = 'pro';
update public.subscription_plans set price_halalas = 299900 where code = 'business';
