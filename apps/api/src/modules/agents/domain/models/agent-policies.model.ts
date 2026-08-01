export interface AgentPolicyReason {
  readonly code: string;
  readonly message: string;
  readonly severity: 'ERROR' | 'WARNING' | 'INFO';
}

export interface AgentPolicyDecision {
  readonly status: 'ALLOW' | 'DENY';
  readonly reasons: AgentPolicyReason[];
  readonly policyVersion: number;
  readonly evaluatedAt: Date;
}
