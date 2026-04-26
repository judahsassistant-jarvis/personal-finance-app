import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Upload, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { fetchAccounts } from '../store/accountsSlice.js';
import { fetchTransactions, parseCSVFile, confirmImport, clearImport } from '../store/transactionsSlice.js';
import { fetchImportBatches, removeImportBatch } from '../store/importBatchesSlice.js';
import { detectBankMismatch } from '../services/bankNameGuard.js';
import { formatGBP, LIQUIDITY } from '../firebase/schema.js';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/card.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { Alert, AlertDescription } from '../components/ui/alert.jsx';
import { Badge } from '../components/ui/badge.jsx';

const PREVIEW_ROWS = 20;

const FIELD_CLASSES =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function Import() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const accounts = useSelector((s) => s.accounts.items);
  const accountsLoading = useSelector((s) => s.accounts.loading);
  const importResult = useSelector((s) => s.transactions.importResult);
  const importLoading = useSelector((s) => s.transactions.importLoading);
  const importError = useSelector((s) => s.transactions.error);

  const [file, setFile] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState(null);
  const [postCommit, setPostCommit] = useState(null);

  useEffect(() => {
    dispatch(fetchAccounts());
    // Eager-fetch transactions so the preview can partition into new vs
    // duplicate against the in-memory list — avoids an extra Firestore round
    // trip at preview time. Transactions are loaded lazily today so this is
    // the first place they're needed pre-Import.
    dispatch(fetchTransactions());
    // Past-imports list (audit Gap 4) — drives the lower section of the page.
    dispatch(fetchImportBatches());
  }, [dispatch]);

  // Default account selection to the first liquid account once accounts load.
  // Importing transactions onto a SIPP / pension is conceptually wrong, so
  // we only offer liquid accounts in the dropdown.
  const liquidAccounts = useMemo(
    () => accounts.filter((a) => a.liquidity === LIQUIDITY.LIQUID),
    [accounts],
  );
  useEffect(() => {
    if (!accountId && liquidAccounts.length > 0) {
      setAccountId(liquidAccounts[0].id);
    }
  }, [liquidAccounts, accountId]);

  async function handleParse(e) {
    e?.preventDefault?.();
    if (!file || !accountId) return;
    await dispatch(parseCSVFile({ file, accountId }));
  }

  async function handleConfirm() {
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await dispatch(confirmImport()).unwrap();
      setPostCommit({
        count: result.written.length,
        skipped: result.skipped,
        batchId: importResult?.batch_id,
      });
      setFile(null);
    } catch (err) {
      setCommitError(err.message ?? 'Failed to commit import');
    } finally {
      setCommitting(false);
    }
  }

  function handleCancel() {
    dispatch(clearImport());
    setCommitError(null);
  }

  function handleStartOver() {
    setPostCommit(null);
    setCommitError(null);
  }

  if (postCommit) {
    return (
      <PostCommitView
        count={postCommit.count}
        skipped={postCommit.skipped}
        onStartOver={handleStartOver}
        navigate={navigate}
      />
    );
  }

  if (importResult) {
    return (
      <PreviewView
        result={importResult}
        accounts={accounts}
        accountId={accountId}
        committing={committing}
        commitError={commitError}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <UploadView
      file={file}
      setFile={setFile}
      accountId={accountId}
      setAccountId={setAccountId}
      liquidAccounts={liquidAccounts}
      accountsLoading={accountsLoading}
      importLoading={importLoading}
      importError={importError}
      onParse={handleParse}
    />
  );
}

// ---------------------------------------------------------------------------
// Upload step
// ---------------------------------------------------------------------------

function UploadView({
  file, setFile, accountId, setAccountId, liquidAccounts,
  accountsLoading, importLoading, importError, onParse,
}) {
  const dispatch = useDispatch();
  const accounts = useSelector((s) => s.accounts.items);
  const batches = useSelector((s) => s.importBatches.items);
  const batchesLoading = useSelector((s) => s.importBatches.loading);
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );
  const canSubmit = !!file && !!accountId && !importLoading;

  async function handleDeleteBatch(batch) {
    const account = accountById.get(batch.account_id);
    const periodLabel = batch.period_start && batch.period_end
      ? ` (${batch.period_start} → ${batch.period_end})`
      : '';
    const confirmed = window.confirm(
      `Delete ${batch.count} transaction${batch.count === 1 ? '' : 's'} imported into ${account?.name ?? 'unknown account'}${periodLabel}?\n\n` +
      `This cannot be undone. Tagged debt payments and transfer pairs in this batch will be cleared.`,
    );
    if (!confirmed) return;
    await dispatch(removeImportBatch(batch.id)).unwrap();
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Import transactions</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload a bank statement CSV. The Claude statement processor (running as a
          scheduled task) drops standardised CSVs into your{' '}
          <span className="font-mono">PFA-statements/</span> Drive folder — pick one
          of those, or any bank-format CSV you've exported manually.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>
            Bank account statements only for now. Credit card statements are deferred to 2b.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onParse} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="i-file" className="text-sm font-medium">CSV file</label>
              <Input
                id="i-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-mono">{file.name}</span> ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="i-account" className="text-sm font-medium">Import into account</label>
              {accountsLoading && liquidAccounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Loading accounts…</p>
              ) : liquidAccounts.length === 0 ? (
                <Alert variant="destructive">
                  <AlertDescription>
                    No liquid accounts found. Add a current or savings account first via the Accounts page.
                  </AlertDescription>
                </Alert>
              ) : (
                <select
                  id="i-account"
                  className={FIELD_CLASSES}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {liquidAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>

            {importError && (
              <Alert variant="destructive">
                <AlertDescription>{importError}</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end">
              <Button type="submit" variant="accent" disabled={!canSubmit}>
                <Upload className="w-4 h-4 mr-2" />
                {importLoading ? 'Parsing…' : 'Parse + preview'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <PastImportsSection
        batches={batches}
        loading={batchesLoading}
        accountById={accountById}
        onDelete={handleDeleteBatch}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past imports (audit Gap 4: provenance + undo)
// ---------------------------------------------------------------------------

function PastImportsSection({ batches, loading, accountById, onDelete }) {
  if (loading && batches.length === 0) {
    return <p className="text-sm text-muted-foreground">Loading past imports…</p>;
  }
  if (batches.length === 0) {
    return null; // empty state — first-time imports skip this section entirely
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Past imports</CardTitle>
        <CardDescription>
          Every batch you've imported. Delete a batch to remove all the transactions
          it created — useful if you imported into the wrong account or want to redo
          a statement after fixing a parsing issue.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-border">
          {batches.map((b) => (
            <PastImportRow
              key={b.id}
              batch={b}
              account={accountById.get(b.account_id)}
              onDelete={() => onDelete(b)}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PastImportRow({ batch, account, onDelete }) {
  const importedAt = batch.imported_at ? formatBatchTimestamp(batch.imported_at) : '—';
  const period = batch.period_start && batch.period_end
    ? `${batch.period_start} → ${batch.period_end}`
    : null;
  return (
    <li className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{account?.name ?? '(deleted account)'}</span>
          <Badge variant="secondary" className="text-[10px]">
            {batch.count} txn{batch.count === 1 ? '' : 's'}
          </Badge>
          {batch.balance_check?.startsWith('OK') && (
            <Badge variant="default" className="text-[10px]">balance OK</Badge>
          )}
          {batch.balance_check?.startsWith('MISMATCH') && (
            <Badge variant="destructive" className="text-[10px]">balance mismatch</Badge>
          )}
          {batch.historical && (
            <Badge variant="outline" className="text-[10px]">historical</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 space-x-2">
          <span>{importedAt}</span>
          {period && <span>· {period}</span>}
          <span>· {batch.format}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDelete}
        title="Delete this batch + all its transactions"
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </li>
  );
}

function formatBatchTimestamp(ts) {
  const d = ts instanceof Date ? ts : new Date(typeof ts === 'number' ? ts : (ts?.seconds ?? 0) * 1000);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Preview step
// ---------------------------------------------------------------------------

function PreviewView({
  result, accounts, accountId, committing, commitError, onConfirm, onCancel,
}) {
  const account = accounts.find((a) => a.id === accountId);
  const md = result.metadata ?? {};
  const sampleRows = result.transactions.slice(0, PREVIEW_ROWS);
  const balanceCheck = md.balance_check ?? null;
  const balanceBadgeVariant =
    balanceCheck?.startsWith('OK') ? 'default'
      : balanceCheck?.startsWith('MISMATCH') ? 'destructive'
      : balanceCheck?.startsWith('N/A') ? 'secondary'
      : null;

  // Audit Gap 1 — partition into new vs duplicate against in-memory
  // transactions. Eager-fetch on Import page mount loads them into Redux so
  // this is a pure client-side compute (no Firestore round trip).
  const existingTxs = useSelector((s) => s.transactions.items);
  const existingDedupKeys = useMemo(
    () => new Set(existingTxs.map((t) => t.dedup_key).filter(Boolean)),
    [existingTxs],
  );
  const { newCount, duplicateCount } = useMemo(() => {
    let n = 0;
    let d = 0;
    for (const t of result.transactions) {
      if (t.dedup_key && existingDedupKeys.has(t.dedup_key)) d += 1;
      else n += 1;
    }
    return { newCount: n, duplicateCount: d };
  }, [result.transactions, existingDedupKeys]);

  // Audit Gap 5 — wrong-account import guard. The Claude-statement metadata
  // block carries `#bank` / `#account`; if neither shares a 4+ char word
  // with the selected account name, it's almost certainly the wrong file.
  const bankMismatch = useMemo(
    () => detectBankMismatch(md, account),
    [md, account],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Preview import</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review the parsed file before committing to <span className="font-medium text-foreground">{account?.name ?? '(unknown account)'}</span>.
            Nothing has been written yet.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={committing}>Cancel</Button>
          <Button variant="accent" onClick={onConfirm} disabled={committing || newCount === 0}>
            {committing
              ? 'Importing…'
              : newCount === 0
                ? 'Nothing new to import'
                : `Confirm + import ${newCount} new txn${newCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>

      {bankMismatch && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>
            This statement looks like it's from <span className="font-medium">{bankMismatch.statementBank}</span>
            {' '}but you've selected <span className="font-medium">{account?.name ?? '(unknown)'}</span>.
            Double-check before importing — wrong-account imports are not easy to undo today.
          </AlertDescription>
        </Alert>
      )}

      <SummaryStrip result={result} newCount={newCount} duplicateCount={duplicateCount} />

      {Object.keys(md).length > 0 && (
        <MetadataCard metadata={md} balanceCheck={balanceCheck} balanceBadgeVariant={balanceBadgeVariant} />
      )}

      {commitError && (
        <Alert variant="destructive">
          <AlertDescription>{commitError}</AlertDescription>
        </Alert>
      )}

      {result.transactions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No transactions parsed</CardTitle>
            <CardDescription>
              The file was readable but contained no data rows the parser could understand.
              Format detected: <span className="font-mono">{result.format}</span>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sample rows</CardTitle>
            <CardDescription>
              Showing first {Math.min(PREVIEW_ROWS, result.transactions.length)} of {result.transactions.length}.
              All rows will be written on confirm.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase tracking-wide bg-muted/50">
                  <tr>
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">Merchant</th>
                    <th className="text-left py-2 px-3 font-medium">Category</th>
                    <th className="text-right py-2 px-3 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((t, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-2 px-3 font-mono text-xs">{t.date}</td>
                      <td className="py-2 px-3">
                        {t.merchant}
                        {t.is_recurring && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">recurring</Badge>
                        )}
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{t.category}</td>
                      <td className={`py-2 px-3 text-right font-mono tabular-nums ${t.amount_pennies < 0 ? 'text-destructive' : 'text-emerald-600'}`}>
                        {formatGBP(t.amount_pennies)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SummaryStrip({ result, newCount, duplicateCount }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Format" value={result.format} mono />
        <Tile label="Transactions" value={result.count.toString()} />
        <Tile label="Total debits" value={formatGBP(result.total_debit_pennies)} />
        <Tile label="Total credits" value={formatGBP(result.total_credit_pennies)} />
      </div>
      {duplicateCount > 0 && (
        <div className="rounded-md border border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{newCount} new</span>,
          {' '}<span className="font-medium text-foreground">{duplicateCount} duplicate</span>
          {duplicateCount === 1 ? '' : 's'} (already imported — will be skipped).
        </div>
      )}
    </div>
  );
}


function MetadataCard({ metadata, balanceCheck, balanceBadgeVariant }) {
  const entries = Object.entries(metadata);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Statement metadata
          {balanceCheck && balanceBadgeVariant && (
            <Badge variant={balanceBadgeVariant} className="text-[10px]">
              {balanceCheck.split(' ')[0]}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Parsed from the <span className="font-mono">#</span>-prefixed comments at the top of the file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground font-mono text-xs">#{k}</dt>
              <dd className="text-foreground text-right">
                {v.startsWith('MISMATCH') ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <AlertTriangle className="w-3 h-3" /> {v}
                  </span>
                ) : v}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, mono }) {
  return (
    <div className="rounded-md border border-border bg-background px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${mono ? 'font-mono' : 'tabular-nums'}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Post-commit step
// ---------------------------------------------------------------------------

function PostCommitView({ count, skipped, onStartOver, navigate }) {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-6 h-6 text-emerald-600 mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Imported {count} transaction{count === 1 ? '' : 's'}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {skipped > 0 && (
              <>
                Skipped <span className="font-medium text-foreground">{skipped}</span> duplicate{skipped === 1 ? '' : 's'} that were already imported.{' '}
              </>
            )}
            They're written to Firestore and will appear on the Transactions page.
            Auto-detected debt-payment matches show up there as suggestions.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="accent" onClick={() => navigate('/transactions')}>
          Go to Transactions
        </Button>
        <Button variant="ghost" onClick={onStartOver}>
          Import another
        </Button>
      </div>
    </div>
  );
}
