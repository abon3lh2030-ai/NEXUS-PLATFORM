import { describe, expect, it } from 'vitest';
import { simulateTechCost, type SimInputs } from './founder.js';

const base: SimInputs = {
  companies: 100, requests_per_company_month: 1000, input_tokens_per_request: 1_000_000, output_tokens_per_request: 0,
  api_input_usd_per_mtok: 1, api_output_usd_per_mtok: 0, usd_to_sar: 1, cloud_hosting_month: 0,
  mac_strong_count: 1, mac_strong_price: 1_200_000, mac_medium_count: 0, mac_medium_price: 0, mac_voice_count: 0, mac_voice_price: 0,
  room_setup: 0, hardware_life_years: 4, power_kwh_month: 0, power_sar_per_kwh: 0, rent_year: 0, internet_year: 0,
  maintenance_year: 0, salaries_year: 0, training_year: 0, other_opex_year: 0, years: 3,
};

describe('technology cost simulator', () => {
  it('computes API cost, break-even and savings', () => {
    const r = simulateTechCost(base);
    expect(r.api_cost_per_request).toBe(1);
    expect(r.cloud_cost_year).toBe(1_200_000);
    expect(r.capex).toBe(1_200_000);
    expect(r.break_even_months).toBe(12);
    expect(r.depreciation_year).toBe(300_000);
    expect(r.break_even_companies).toBe(25);
    expect(r.savings_total).toBe(2_400_000);
    expect(r.years.map((y) => y.owned)).toEqual([1_200_000, 0, 0]);
  });

  it('has no break-even when owning costs more to run than the cloud', () => {
    const r = simulateTechCost({ ...base, companies: 0, maintenance_year: 10 });
    expect(r.break_even_months).toBeNull();
    expect(r.cloud_per_company_year).toBe(0);
  });

  it('ignores negative or invalid inputs and applies growth', () => {
    const r = simulateTechCost({ ...base, companies_growth_pct: 100, rent_year: -5, years: 2 });
    expect(r.owned_opex_year).toBe(0);
    expect(r.years[1]!.companies).toBe(200);
  });
});
