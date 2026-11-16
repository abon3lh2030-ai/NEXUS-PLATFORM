/**
 * Technology Cost Simulator — continuing on external cloud AI APIs vs moving to owned infrastructure.
 * Pure function so the Founder Portal and tests compute exactly the same numbers. All amounts in SAR.
 */
export interface SimInputs {
  companies: number;
  /** Yearly growth of the number of companies, in %. */
  companies_growth_pct?: number;
  requests_per_company_month: number;
  input_tokens_per_request: number;
  output_tokens_per_request: number;
  api_input_usd_per_mtok: number;
  api_output_usd_per_mtok: number;
  usd_to_sar: number;
  /** Database + hosting that both paths keep paying for (Supabase/Render). */
  cloud_hosting_month: number;
  mac_strong_count: number;
  mac_strong_price: number;
  mac_medium_count: number;
  mac_medium_price: number;
  mac_voice_count: number;
  mac_voice_price: number;
  room_setup: number;
  hardware_life_years: number;
  power_kwh_month: number;
  power_sar_per_kwh: number;
  rent_year: number;
  internet_year: number;
  maintenance_year: number;
  salaries_year: number;
  training_year: number;
  other_opex_year: number;
  years: number;
}

export interface SimYear {
  year: number;
  companies: number;
  requests: number;
  cloud: number;
  owned: number;
  cloud_cumulative: number;
  owned_cumulative: number;
}

export interface SimResult {
  requests_year: number;
  api_cost_per_request: number;
  api_cost_year: number;
  cloud_cost_year: number;
  capex: number;
  depreciation_year: number;
  power_year: number;
  owned_opex_year: number;
  owned_cost_year: number;
  cloud_per_company_year: number;
  owned_per_company_year: number;
  cloud_per_request: number;
  owned_per_request: number;
  break_even_months: number | null;
  break_even_companies: number | null;
  savings_total: number;
  roi_pct: number | null;
  years: SimYear[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

export function simulateTechCost(raw: SimInputs): SimResult {
  const i = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, pos(v)])) as unknown as SimInputs;
  const years = Math.min(10, Math.max(1, Math.round(i.years || 3)));
  const life = i.hardware_life_years || 4;

  const costPerRequest = ((i.input_tokens_per_request * i.api_input_usd_per_mtok + i.output_tokens_per_request * i.api_output_usd_per_mtok) / 1_000_000) * i.usd_to_sar;
  const requestsYear = i.companies * i.requests_per_company_month * 12;
  const apiYear = requestsYear * costPerRequest;
  const hostingYear = i.cloud_hosting_month * 12;
  const cloudYear = apiYear + hostingYear;

  const capex = i.mac_strong_count * i.mac_strong_price + i.mac_medium_count * i.mac_medium_price + i.mac_voice_count * i.mac_voice_price + i.room_setup;
  const depreciation = capex / life;
  const powerYear = i.power_kwh_month * 12 * i.power_sar_per_kwh;
  const opexYear = powerYear + i.rent_year + i.internet_year + i.maintenance_year + i.salaries_year + i.training_year + i.other_opex_year + hostingYear;
  const ownedYear = depreciation + opexYear;

  // Months for the monthly saving (cloud − owned running cost) to pay back the hardware.
  const monthlySaving = (cloudYear - opexYear) / 12;
  const breakEvenMonths = monthlySaving > 0 ? Math.round((capex / monthlySaving) * 10) / 10 : null;
  // Companies at which owning is cheaper per year (depreciation included).
  const apiPerCompany = i.requests_per_company_month * 12 * costPerRequest;
  const breakEvenCompanies = apiPerCompany > 0 ? Math.ceil((depreciation + opexYear - hostingYear) / apiPerCompany) : null;

  const growth = 1 + (i.companies_growth_pct || 0) / 100;
  const out: SimYear[] = [];
  let cloudCum = 0;
  let ownedCum = 0;
  for (let y = 1; y <= years; y++) {
    const companies = i.companies * growth ** (y - 1);
    const req = companies * i.requests_per_company_month * 12;
    const cloud = req * costPerRequest + hostingYear;
    // Cash view: hardware is paid in year 1, renewed after its life.
    const owned = opexYear + ((y - 1) % life === 0 ? capex : 0);
    cloudCum += cloud;
    ownedCum += owned;
    out.push({ year: y, companies: Math.round(companies), requests: Math.round(req), cloud: r2(cloud), owned: r2(owned), cloud_cumulative: r2(cloudCum), owned_cumulative: r2(ownedCum) });
  }
  const savings = cloudCum - ownedCum;

  return {
    requests_year: Math.round(requestsYear),
    api_cost_per_request: Math.round(costPerRequest * 10000) / 10000,
    api_cost_year: r2(apiYear),
    cloud_cost_year: r2(cloudYear),
    capex: r2(capex),
    depreciation_year: r2(depreciation),
    power_year: r2(powerYear),
    owned_opex_year: r2(opexYear),
    owned_cost_year: r2(ownedYear),
    cloud_per_company_year: i.companies ? r2(cloudYear / i.companies) : 0,
    owned_per_company_year: i.companies ? r2(ownedYear / i.companies) : 0,
    cloud_per_request: requestsYear ? Math.round((cloudYear / requestsYear) * 10000) / 10000 : 0,
    owned_per_request: requestsYear ? Math.round((ownedYear / requestsYear) * 10000) / 10000 : 0,
    break_even_months: breakEvenMonths,
    break_even_companies: breakEvenCompanies,
    savings_total: r2(savings),
    roi_pct: capex ? Math.round((savings / capex) * 1000) / 10 : null,
    years: out,
  };
}
