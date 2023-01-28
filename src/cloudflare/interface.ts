export interface CFZoneResponse {
  result: {
    id: string;
    name: string;
    status: 'active';
    paused: boolean;
    type: 'full';
    development_mode: number;
    name_servers: string[];
    original_name_servers: string[];
    original_registrar: string;
    original_dnshost: string | null;
    modified_on: string;
    created_on: string;
    activated_on: string;
    meta: {
      step: number;
      custom_certificate_quota: number;
      page_rule_quota: number;
      phishing_detected: boolean;
      multiple_railguns_allowed: boolean;
    };
    owner: {
      id: string;
      type: string;
      email: string;
    };
    account: {
      id: string;
      name: string;
    };
  };
}
