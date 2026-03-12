// Intelligent risk classification for approval requests

interface DiffPayload {
  type?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  preview?: string;
  structuredData?: Record<string, unknown>;
}

interface RiskResult {
  level: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
  score: number; // 0-100, higher = more risky
}

// Sensitive file patterns
const CRITICAL_PATTERNS = [
  /\.env/i, /secrets?\./i, /credentials/i, /\.pem$/i, /\.key$/i,
  /password/i, /api[_-]?key/i, /token/i,
];

const HIGH_PATTERNS = [
  /migration/i, /schema/i, /deploy/i, /dockerfile/i,
  /\.ya?ml$/i, /ci\//i, /\.github\//i, /infra\//i,
  /terraform/i, /cloudformation/i, /k8s/i, /kubernetes/i,
  /package\.json$/i, /package-lock/i, /yarn\.lock/i,
  /firestore\.rules/i, /security/i,
];

const LOW_PATTERNS = [
  /\.md$/i, /readme/i, /changelog/i, /license/i,
  /\.txt$/i, /\.css$/i, /\.scss$/i, /\.less$/i,
  /\.svg$/i, /\.png$/i, /\.jpg$/i, /\.ico$/i,
  /\.test\./i, /\.spec\./i, /__tests__/i,
  /\.snap$/i, /\.stories\./i,
];

// Sensitive content patterns in diff preview
const SENSITIVE_CONTENT = [
  /[A-Za-z0-9+/]{40,}/, // long base64 strings (potential secrets)
  /sk[-_][a-zA-Z0-9]{20,}/, // API keys
  /password\s*[:=]\s*["'][^"']+["']/i,
  /DROP\s+TABLE/i, /DELETE\s+FROM/i, /TRUNCATE/i,
  /rm\s+-rf/i, /--force/i, /--no-verify/i,
  /process\.env\./i,
];

export function classifyRisk(
  agentRiskLevel: string | undefined,
  title: string,
  diffPayload: DiffPayload | undefined
): RiskResult {
  const reasons: string[] = [];
  let score = 0;

  const filesChanged = diffPayload?.filesChanged || 0;
  const insertions = diffPayload?.insertions || 0;
  const deletions = diffPayload?.deletions || 0;
  const totalChanges = insertions + deletions;
  const preview = diffPayload?.preview || '';
  const filePaths: string[] = (diffPayload?.structuredData?.filePaths as string[]) || [];

  // 1. Volume-based scoring
  if (filesChanged > 20) {
    score += 40;
    reasons.push(`Large change set: ${filesChanged} files`);
  } else if (filesChanged > 10) {
    score += 25;
    reasons.push(`Moderate change set: ${filesChanged} files`);
  } else if (filesChanged <= 2 && totalChanges <= 15) {
    score -= 10;
    reasons.push('Small, focused change');
  }

  if (totalChanges > 500) {
    score += 20;
    reasons.push(`High line churn: +${insertions}/-${deletions}`);
  }

  if (deletions > insertions * 2 && deletions > 50) {
    score += 15;
    reasons.push('Heavy deletions — review for data loss');
  }

  // 2. File pattern analysis
  for (const fp of filePaths) {
    if (CRITICAL_PATTERNS.some((p) => p.test(fp))) {
      score += 50;
      reasons.push(`Critical file: ${fp}`);
      break;
    }
  }

  for (const fp of filePaths) {
    if (HIGH_PATTERNS.some((p) => p.test(fp))) {
      score += 20;
      reasons.push(`Infrastructure/config file: ${fp}`);
      break;
    }
  }

  const allLowRisk = filePaths.length > 0 &&
    filePaths.every((fp) => LOW_PATTERNS.some((p) => p.test(fp)));
  if (allLowRisk) {
    score -= 20;
    reasons.push('All files are low-risk (docs/tests/styles)');
  }

  // 3. Title keyword analysis
  const titleLower = title.toLowerCase();
  if (/deploy|release|production|prod\b/.test(titleLower)) {
    score += 30;
    reasons.push('Title indicates deployment/production change');
  }
  if (/migration|schema|database/.test(titleLower)) {
    score += 25;
    reasons.push('Title indicates schema/migration change');
  }
  if (/fix\s+typo|readme|comment|format|lint/.test(titleLower)) {
    score -= 15;
    reasons.push('Title suggests low-risk formatting/docs change');
  }
  if (/refactor|rename|cleanup/.test(titleLower)) {
    score += 5;
    reasons.push('Refactoring change — moderate review needed');
  }

  // 4. Diff content analysis
  if (preview) {
    for (const pattern of SENSITIVE_CONTENT) {
      if (pattern.test(preview)) {
        score += 30;
        reasons.push('Diff contains potentially sensitive content');
        break;
      }
    }
  }

  // 5. Diff type
  if (diffPayload?.type === 'document') {
    score -= 10;
    reasons.push('Document-type change');
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Map score to level
  let level: RiskResult['level'];
  if (score >= 70) level = 'critical';
  else if (score >= 40) level = 'high';
  else if (score >= 15) level = 'medium';
  else level = 'low';

  // Agent can only escalate, never downgrade
  if (agentRiskLevel) {
    const agentIdx = ['low', 'medium', 'high', 'critical'].indexOf(agentRiskLevel);
    const classifiedIdx = ['low', 'medium', 'high', 'critical'].indexOf(level);
    if (agentIdx > classifiedIdx) {
      level = agentRiskLevel as RiskResult['level'];
      reasons.push(`Agent requested ${agentRiskLevel} risk (higher than classified)`);
    }
  }

  return { level, reasons, score };
}
