import { createHash } from 'crypto';
import { Request, Response, Router } from 'express';
import Ad from '../models/Ad';
import { getValidToken, mercadoLivreRequest, HttpError, toHttpError } from '../lib/mercadoLibre';
import { getOptionalSession, requireSession } from '../lib/session';

const router = Router();

type MercadoLivreItem = {
  id: string;
  site_id?: string;
  category_id?: string;
  listing_type_id?: string;
  currency_id?: string;
  title?: string;
  price?: number;
  available_quantity?: number;
  sold_quantity?: number;
  condition?: string;
  thumbnail?: string;
  permalink?: string;
  status?: string;
};

type ListingTypeResponse = {
  category_id?: string;
  available?: Array<{ id: string; name: string }>;
};

type CategoryAttributeResponse = {
  id: string;
  name: string;
  value_type?: string;
  value_max_length?: number;
  tags?: Record<string, boolean | string | number>;
  values?: Array<{ id?: string; name?: string }>;
  allowed_units?: Array<{ id?: string; name?: string }>;
  default_unit?: string;
  tooltip?: string;
  attribute_group_id?: string;
  attribute_group_name?: string;
};

type CategoryDetailsResponse = {
  id: string;
  name: string;
  path_from_root?: Array<{ id: string; name: string }>;
  settings?: {
    max_title_length?: number;
  };
};

type CategoryPredictionResponse = {
  category_id?: string;
  category_name?: string;
  domain_id?: string;
  domain_name?: string;
};

type ValidationCause = {
  cause_id?: number | string;
  code?: string;
  type?: string;
  message?: string;
  references?: string[];
};

type PublicationAttribute = {
  id: string;
  value_id?: string;
  value_name?: string;
  value_struct?: {
    number: number;
    unit: string;
  };
};

type PersistRemoteItemOptions = {
  sellerUserId: string;
  source: 'sync' | 'create' | 'update';
};

type SyncJobStatus = 'idle' | 'running' | 'completed' | 'failed';

type SyncJobState = {
  sellerUserId: string;
  status: SyncJobStatus;
  startedAt?: string;
  finishedAt?: string;
  syncedAt?: string;
  totalItems: number;
  totalBatches: number;
  processedBatches: number;
  warnings: string[];
  error?: string;
  summary?: ReturnType<typeof buildSummary>;
};

const SYNC_BATCH_SIZE = 20;
const syncJobs = new Map<string, SyncJobState>();

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

const parseText = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Field "${fieldName}" is required.`);
  }

  return value.trim();
};

const parseNumber = (value: unknown, fieldName: string, allowZero = false): number => {
  const parsedValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsedValue) || (!allowZero && parsedValue <= 0) || (allowZero && parsedValue < 0)) {
    throw new HttpError(400, `Field "${fieldName}" must be a valid number.`);
  }

  return parsedValue;
};

const parseInteger = (value: unknown, fieldName: string, allowZero = false): number => {
  const parsedValue = parseNumber(value, fieldName, allowZero);

  if (!Number.isInteger(parsedValue)) {
    throw new HttpError(400, `Field "${fieldName}" must be an integer.`);
  }

  return parsedValue;
};

const parseDate = (value: unknown, fieldName: string): Date => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `Field "${fieldName}" is required.`);
  }

  const parsedValue = new Date(value);

  if (Number.isNaN(parsedValue.getTime())) {
    throw new HttpError(400, `Field "${fieldName}" must be a valid date string.`);
  }

  return parsedValue;
};

const toPictureArray = (value: unknown): Array<{ source: string }> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const pictures = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .map((source) => ({ source }));

  return pictures.length > 0 ? pictures : undefined;
};

const normalizeAttributesInput = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attributes = value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const candidate = item as {
        id?: unknown;
        value_id?: unknown;
        value_name?: unknown;
        value_struct?: { number?: unknown; unit?: unknown };
      };

      if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
        return null;
      }

      const normalized: PublicationAttribute = {
        id: candidate.id.trim(),
      };

      if (typeof candidate.value_id === 'string' && candidate.value_id.trim()) {
        normalized.value_id = candidate.value_id.trim();
      }

      if (typeof candidate.value_name === 'string' && candidate.value_name.trim()) {
        normalized.value_name = candidate.value_name.trim();
      }

      if (candidate.value_struct && typeof candidate.value_struct === 'object') {
        const parsedNumber = parseNumber(candidate.value_struct.number, `${candidate.id}.value_struct.number`, true);
        const unit =
          typeof candidate.value_struct.unit === 'string' && candidate.value_struct.unit.trim()
            ? candidate.value_struct.unit.trim()
            : '';

        if (!unit) {
          throw new HttpError(400, `Field "${candidate.id}.value_struct.unit" is required.`);
        }

        normalized.value_struct = {
          number: parsedNumber,
          unit,
        };
      }

      if (
        normalized.value_id === undefined &&
        normalized.value_name === undefined &&
        normalized.value_struct === undefined
      ) {
        return null;
      }

      return normalized;
    })
    .filter((item): item is PublicationAttribute => Boolean(item));

  return attributes.length > 0 ? attributes : undefined;
};

const buildPublicationPayload = (body: Request['body']) => {
  return {
    title: parseText(body.title, 'title'),
    category_id: parseText(body.category_id, 'category_id'),
    price: parseNumber(body.price, 'price'),
    currency_id:
      typeof body.currency_id === 'string' && body.currency_id.trim() ? body.currency_id.trim() : 'BRL',
    available_quantity: parseInteger(body.available_quantity, 'available_quantity'),
    buying_mode:
      typeof body.buying_mode === 'string' && body.buying_mode.trim() ? body.buying_mode.trim() : 'buy_it_now',
    listing_type_id: parseText(body.listing_type_id, 'listing_type_id'),
    condition:
      typeof body.condition === 'string' && body.condition.trim() ? body.condition.trim() : 'new',
    pictures: toPictureArray(body.pictures),
    attributes: normalizeAttributesInput(body.attributes),
    // FORÇA O MERCADO ENVIOS (ME2) PARA CORRIGIR O ERRO DE SHIPPING
    shipping: {
      mode: 'me2',
      local_pick_up: false, // Pode mudar para true se quiser permitir retirar em mãos
    },
  };
};

const ensureHiddenConditionalAttributes = (attributes: ReturnType<typeof normalizeAttributesInput>) => {
  if (!attributes) {
    return attributes;
  }

  const gtinAttribute = attributes.find((attribute) => attribute.id === 'GTIN');
  const gtinValue =
    typeof gtinAttribute?.value_name === 'string'
      ? gtinAttribute.value_name.trim()
      : typeof gtinAttribute?.value_id === 'string'
        ? gtinAttribute.value_id.trim()
        : '';

  const hasGtin = Boolean(gtinValue);

  if (hasGtin) {
    return attributes.filter((attribute) => attribute.id !== 'EMPTY_GTIN_REASON');
  }

  const hasEmptyGtinReason = attributes.some((attribute) => attribute.id === 'EMPTY_GTIN_REASON');

  if (hasEmptyGtinReason) {
    return attributes;
  }

  return [
    ...attributes,
    {
      id: 'EMPTY_GTIN_REASON',
      value_name: 'No registrado',
    },
  ];
};

const applyPublicationPayloadDefaults = (
  payload: ReturnType<typeof buildPublicationPayload>
) => {
  const { shipping: _ignoredShipping, ...payloadWithoutShipping } = payload as ReturnType<
    typeof buildPublicationPayload
  > & {
    shipping?: unknown;
  };

  return {
    ...payloadWithoutShipping,
    attributes: ensureHiddenConditionalAttributes(payload.attributes),
  };
};

const buildRemoteStateHash = (item: MercadoLivreItem): string => {
  const normalized = {
    id: item.id,
    title: item.title ?? '',
    price: item.price ?? 0,
    available_quantity: item.available_quantity ?? 0,
    sold_quantity: item.sold_quantity ?? 0,
    status: item.status ?? '',
    category_id: item.category_id ?? '',
    listing_type_id: item.listing_type_id ?? '',
    condition: item.condition ?? '',
    currency_id: item.currency_id ?? '',
    permalink: item.permalink ?? '',
    thumbnail: item.thumbnail ?? '',
  };

  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
};

const buildLocalAdUpdate = (
  item: MercadoLivreItem,
  sellerUserId: string,
  remoteStateHash: string,
  source: PersistRemoteItemOptions['source'],
  previousRemoteStateHash?: string,
  previousRemoteChangeAt?: Date
) => {
  const remoteChanged = Boolean(previousRemoteStateHash && previousRemoteStateHash !== remoteStateHash);
  const syncState = source === 'sync' && remoteChanged ? 'remote_changed' : 'synced';
  const syncNote =
    source === 'sync' && remoteChanged
      ? 'Marketplace item changed since the last stored local snapshot.'
      : '';

  return {
    seller_user_id: sellerUserId,
    ml_id: item.id,
    site_id: item.site_id ?? 'MLB',
    category_id: item.category_id ?? '',
    listing_type_id: item.listing_type_id ?? '',
    currency_id: item.currency_id ?? 'BRL',
    title: item.title ?? 'Untitled item',
    price: item.price ?? 0,
    available_quantity: item.available_quantity ?? 0,
    sold_quantity: item.sold_quantity ?? 0,
    condition: item.condition ?? 'new',
    thumbnail: item.thumbnail ?? '',
    permalink: item.permalink ?? '',
    status: item.status ?? 'unknown',
    sync_state: syncState,
    last_error: '',
    sync_note: syncNote,
    last_sync: new Date(),
    remote_state_hash: remoteStateHash,
    last_remote_change_at: remoteChanged ? new Date() : previousRemoteChangeAt ?? new Date(),
  };
};

const persistRemoteItem = async (
  item: MercadoLivreItem,
  { sellerUserId, source }: PersistRemoteItemOptions
) => {
  const existingItem = await Ad.findOne({ seller_user_id: sellerUserId, ml_id: item.id });
  const remoteStateHash = buildRemoteStateHash(item);

  return Ad.findOneAndUpdate(
    { seller_user_id: sellerUserId, ml_id: item.id },
    buildLocalAdUpdate(
      item,
      sellerUserId,
      remoteStateHash,
      source,
      typeof existingItem?.remote_state_hash === 'string' ? existingItem.remote_state_hash : undefined,
      existingItem?.last_remote_change_at instanceof Date ? existingItem.last_remote_change_at : undefined
    ),
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

const buildSummary = (items: Array<any>) => {
  const total = items.length;
  const active = items.filter((item) => item.status === 'active').length;
  const paused = items.filter((item) => item.status === 'paused').length;
  const lowStock = items.filter((item) => item.available_quantity > 0 && item.available_quantity <= 5).length;
  const unsynced = items.filter((item) => item.sync_state !== 'synced').length;
  const conflicts = items.filter((item) => item.sync_state === 'conflict').length;
  const remoteChanged = items.filter((item) => item.sync_state === 'remote_changed').length;
  const inventoryValue = items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.available_quantity || 0),
    0
  );

  return {
    total,
    active,
    paused,
    lowStock,
    unsynced,
    conflicts,
    remoteChanged,
    inventoryValue,
  };
};

const fetchLocalAds = async (req: Request) => {
  const session = await getOptionalSession(req);

  if (!session?.seller_user_id) {
    return {
      items: [],
      summary: buildSummary([]),
    };
  }

  const query: Record<string, unknown> = {
    seller_user_id: session.seller_user_id,
  };
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const syncState = typeof req.query.sync_state === 'string' ? req.query.sync_state.trim() : '';
  const stock = typeof req.query.stock === 'string' ? req.query.stock.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort.trim() : 'updated_desc';

  if (search) {
    query.title = { $regex: search, $options: 'i' };
  }

  if (status && status !== 'all') {
    query.status = status;
  }

  if (syncState && syncState !== 'all') {
    query.sync_state = syncState;
  }

  if (stock === 'low') {
    query.available_quantity = { $lte: 5, $gt: 0 };
  } else if (stock === 'empty') {
    query.available_quantity = 0;
  }

  const sortMap: Record<string, Record<string, 1 | -1>> = {
    updated_desc: { updatedAt: -1 },
    updated_asc: { updatedAt: 1 },
    price_desc: { price: -1 },
    price_asc: { price: 1 },
    stock_desc: { available_quantity: -1 },
    stock_asc: { available_quantity: 1 },
    title_asc: { title: 1 },
  };

  const items = await Ad.find(query).sort(sortMap[sort] ?? sortMap.updated_desc);

  return {
    items,
    summary: buildSummary(items),
  };
};

const syncSellerAds = async (sellerUserId: string) => {
  const token = await getValidToken(sellerUserId);
  const warnings: string[] = [];
  const searchResult = await mercadoLivreRequest<{ results?: string[] }>({
    method: 'GET',
    url: `/users/${token.user_id}/items/search`,
    userId: sellerUserId,
  });

  const ids = Array.isArray(searchResult.results) ? searchResult.results : [];
  const syncedAt = new Date();

  if (ids.length > 0) {
    const idBatches = chunkArray(ids, SYNC_BATCH_SIZE);
    const runningJob = syncJobs.get(sellerUserId);

    if (runningJob) {
      runningJob.totalItems = ids.length;
      runningJob.totalBatches = idBatches.length;
      syncJobs.set(sellerUserId, runningJob);
    }

    const detailedItemsChunks: Array<Array<{ code: number; body?: MercadoLivreItem; error?: string }>> = [];

    for (const [batchIndex, batch] of idBatches.entries()) {
      const detailedItems = await mercadoLivreRequest<Array<{ code: number; body?: MercadoLivreItem; error?: string }>>({
          method: 'GET',
          url: '/items',
          params: {
            ids: batch.join(','),
          },
          userId: sellerUserId,
        });

      detailedItemsChunks.push(detailedItems);

      const inProgressJob = syncJobs.get(sellerUserId);

      if (inProgressJob) {
        inProgressJob.processedBatches = batchIndex + 1;
        syncJobs.set(sellerUserId, inProgressJob);
      }
    }

    const detailedItems = detailedItemsChunks.flat();

    const persistenceQueue = detailedItems.map(async (entry) => {
      if (entry.code !== 200 || !entry.body?.id) {
        warnings.push(entry.error || 'One item could not be synchronized from Mercado Livre.');
        return null;
      }

      return persistRemoteItem(entry.body, {
        sellerUserId,
        source: 'sync',
      });
    });

    await Promise.all(persistenceQueue);
  }

  await Ad.updateMany(
    ids.length > 0
      ? { seller_user_id: sellerUserId, ml_id: { $nin: ids } }
      : { seller_user_id: sellerUserId },
    {
      $set: {
        sync_state: 'missing_remote',
        sync_note: 'Item was not returned by the Mercado Livre seller inventory search.',
        last_sync: syncedAt,
      },
    }
  );

  const items = await Ad.find({ seller_user_id: sellerUserId }).sort({ updatedAt: -1 });

  return {
    items,
    warnings,
    syncedAt,
    summary: buildSummary(items),
  };
};

const getSyncJobResponse = (sellerUserId: string) => {
  const currentJob = syncJobs.get(sellerUserId);

  if (!currentJob) {
    return {
      sellerUserId,
      status: 'idle' as SyncJobStatus,
      totalItems: 0,
      totalBatches: 0,
      processedBatches: 0,
      warnings: [],
    };
  }

  return currentJob;
};

const runSyncJob = async (sellerUserId: string) => {
  syncJobs.set(sellerUserId, {
    sellerUserId,
    status: 'running',
    startedAt: new Date().toISOString(),
    totalItems: 0,
    totalBatches: 0,
    processedBatches: 0,
    warnings: [],
  });

  try {
    const result = await syncSellerAds(sellerUserId);
    syncJobs.set(sellerUserId, {
      sellerUserId,
      status: 'completed',
      startedAt: syncJobs.get(sellerUserId)?.startedAt,
      finishedAt: new Date().toISOString(),
      syncedAt: result.syncedAt.toISOString(),
      totalItems: result.items.length,
      totalBatches: syncJobs.get(sellerUserId)?.totalBatches ?? 0,
      processedBatches: syncJobs.get(sellerUserId)?.processedBatches ?? 0,
      warnings: result.warnings,
      summary: result.summary,
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to synchronize ads with Mercado Livre.');
    syncJobs.set(sellerUserId, {
      sellerUserId,
      status: 'failed',
      startedAt: syncJobs.get(sellerUserId)?.startedAt,
      finishedAt: new Date().toISOString(),
      totalItems: syncJobs.get(sellerUserId)?.totalItems ?? 0,
      totalBatches: syncJobs.get(sellerUserId)?.totalBatches ?? 0,
      processedBatches: syncJobs.get(sellerUserId)?.processedBatches ?? 0,
      warnings: syncJobs.get(sellerUserId)?.warnings ?? [],
      error: httpError.message,
    });
  }
};

const startSync = async (req: Request, res: Response) => {
  try {
    const session = await requireSession(req);
    const currentJob = syncJobs.get(session.seller_user_id);

    if (currentJob?.status === 'running') {
      res.status(202).json(currentJob);
      return;
    }

    void runSyncJob(session.seller_user_id);
    res.status(202).json(getSyncJobResponse(session.seller_user_id));
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to synchronize ads with Mercado Livre.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
};

const getSyncStatus = async (req: Request, res: Response) => {
  try {
    const session = await requireSession(req);
    res.json(getSyncJobResponse(session.seller_user_id));
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to load the synchronization status.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
};

router.get('/', async (req: Request, res: Response) => {
  try {
    const response = await fetchLocalAds(req);
    res.json(response);
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to load local ads.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/sync', getSyncStatus);
router.post('/sync', startSync);

router.get('/category-predictor', async (req: Request, res: Response) => {
  const title = typeof req.query.title === 'string' ? req.query.title.trim() : '';

  if (title.length < 3) {
    res.status(400).json({ error: 'The title query parameter must have at least 3 characters.' });
    return;
  }

  try {
    const items = await mercadoLivreRequest<CategoryPredictionResponse[]>({
      method: 'GET',
      url: '/sites/MLB/domain_discovery/search',
      params: {
        q: title,
        limit: 6,
      },
    });

    res.json({
      items: items.map((item) => ({
        category_id: item.category_id ?? '',
        category_name: item.category_name ?? '',
        domain_id: item.domain_id ?? '',
        domain_name: item.domain_name ?? '',
      })),
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to predict categories for the provided title.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/category-context', async (req: Request, res: Response) => {
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id.trim() : '';

  if (!categoryId) {
    res.status(400).json({ error: 'The category_id query parameter is required.' });
    return;
  }

  try {
    const session = await requireSession(req);
    const token = await getValidToken(session.seller_user_id);
    const [listingTypesResponse, attributesResponse, categoryResponse] = await Promise.all([
      mercadoLivreRequest<ListingTypeResponse>({
        method: 'GET',
        url: `/users/${token.user_id}/available_listing_types`,
        params: {
          category_id: categoryId,
        },
        userId: session.seller_user_id,
      }),
      mercadoLivreRequest<CategoryAttributeResponse[]>({
        method: 'GET',
        url: `/categories/${categoryId}/attributes`,
        userId: session.seller_user_id,
      }),
      mercadoLivreRequest<CategoryDetailsResponse>({
        method: 'GET',
        url: `/categories/${categoryId}`,
        userId: session.seller_user_id,
      }),
    ]);

    const mappedAttributes = attributesResponse.map((attribute) => {
      const isGtinOrReason = attribute.id === 'GTIN' || attribute.id === 'EMPTY_GTIN_REASON';
      const isRequired =
        Boolean(
          attribute.tags?.required ||
          attribute.tags?.catalog_required ||
          attribute.tags?.conditional_required ||
          attribute.tags?.new_required
        ) || isGtinOrReason;

      return {
        id: attribute.id,
        name: attribute.name,
        value_type: attribute.value_type ?? 'string',
        value_max_length: attribute.value_max_length ?? null,
        tooltip: attribute.tooltip ?? '',
        attribute_group_id: attribute.attribute_group_id ?? '',
        attribute_group_name: attribute.attribute_group_name ?? '',
        required: isRequired,
        hidden: Boolean(attribute.tags?.hidden) && !isGtinOrReason,
        fixed: Boolean(attribute.tags?.fixed),
        values: (attribute.values ?? []).map((value) => ({
          id: value.id ?? '',
          name: value.name ?? '',
        })),
        allowed_units: (attribute.allowed_units ?? []).map((unit) => ({
          id: unit.id ?? '',
          name: unit.name ?? '',
        })),
        default_unit: attribute.default_unit ?? '',
      };
    });

    // INJEÇÃO MANUAL DO GTIN: Se o ML cobrar o GTIN mas não enviar na lista, nós criamos!
    if (!mappedAttributes.find((attr) => attr.id === 'GTIN')) {
      mappedAttributes.unshift({
        id: 'GTIN',
        name: 'Código de Barras (GTIN/EAN)',
        value_type: 'string',
        value_max_length: 14,
        tooltip: 'Obrigatório para produtos novos (ex: 4719331811828)',
        attribute_group_id: '',
        attribute_group_name: '',
        required: true,
        hidden: false,
        fixed: false,
        values: [],
        allowed_units: [],
        default_unit: '',
      });
    }

    res.json({
      category: {
        id: categoryResponse.id,
        name: categoryResponse.name,
        path_from_root: categoryResponse.path_from_root ?? [],
        max_title_length: categoryResponse.settings?.max_title_length ?? 60,
      },
      listingTypes: listingTypesResponse.available ?? [],
      attributes: mappedAttributes,
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to load the category context.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.get('/listing-types', async (req: Request, res: Response) => {
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id.trim() : '';

  if (!categoryId) {
    res.status(400).json({ error: 'The category_id query parameter is required.' });
    return;
  }

  try {
    const session = await requireSession(req);
    const token = await getValidToken(session.seller_user_id);
    const listingTypesResponse = await mercadoLivreRequest<ListingTypeResponse>({
      method: 'GET',
      url: `/users/${token.user_id}/available_listing_types`,
      params: {
        category_id: categoryId,
      },
      userId: session.seller_user_id,
    });

    res.json({ items: listingTypesResponse.available ?? [] });
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to load listing types.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.post('/validate', async (req: Request, res: Response) => {
  try {
    const session = await requireSession(req);
    const payload = buildPublicationPayload(req.body);
    const response = await mercadoLivreRequest<{
      status?: string;
      cause?: ValidationCause[];
    }>({
      method: 'POST',
      url: '/items/validate',
      data: applyPublicationPayloadDefaults(payload),
      userId: session.seller_user_id,
    });

    res.json({
      valid: true,
      status: response.status ?? 'ok',
      issues: Array.isArray(response.cause) ? response.cause : [],
    });
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to validate the ad payload.');

    if (httpError.status === 400) {
      const details =
        httpError.details && typeof httpError.details === 'object' ? (httpError.details as { cause?: ValidationCause[] }) : {};

      res.status(400).json({
        valid: false,
        error: httpError.message,
        issues: Array.isArray(details.cause) ? details.cause : [],
        details: httpError.details,
      });
      return;
    }

    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const session = await requireSession(req);
    const payload = buildPublicationPayload(req.body);

    const createdItem = await mercadoLivreRequest<MercadoLivreItem>({
      method: 'POST',
      url: '/items',
      data: applyPublicationPayloadDefaults(payload),
      userId: session.seller_user_id,
    });

    const storedItem = await persistRemoteItem(createdItem, {
      sellerUserId: session.seller_user_id,
      source: 'create',
    });

    res.status(201).json(storedItem);
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to create the ad on Mercado Livre.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const session = await requireSession(req);
    const currentAd = await Ad.findOne({
      seller_user_id: session.seller_user_id,
      ml_id: req.params.id,
    });

    if (!currentAd) {
      throw new HttpError(404, 'The requested ad was not found for this seller session.');
    }

    if (req.body.expected_updated_at !== undefined) {
      const expectedUpdatedAt = parseDate(req.body.expected_updated_at, 'expected_updated_at');
      const currentUpdatedAt = currentAd.updatedAt instanceof Date ? currentAd.updatedAt : null;

      if (!currentUpdatedAt || currentUpdatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        currentAd.sync_state = 'conflict';
        currentAd.last_error = 'Optimistic lock blocked this update because a newer local version already exists.';
        currentAd.sync_note = 'Reload the list before trying to update this item again.';
        currentAd.last_sync = new Date();
        await currentAd.save();

        throw new HttpError(409, 'The ad changed before this update was saved. Reload the list and try again.');
      }
    }

    const updates: Record<string, unknown> = {};

    if (req.body.title !== undefined) {
      updates.title = parseText(req.body.title, 'title');
    }

    if (req.body.price !== undefined) {
      updates.price = parseNumber(req.body.price, 'price');
    }

    if (req.body.available_quantity !== undefined) {
      updates.available_quantity = parseInteger(req.body.available_quantity, 'available_quantity', true);
    }

    if (Object.keys(updates).length === 0) {
      throw new HttpError(400, 'At least one editable field must be provided.');
    }

    await mercadoLivreRequest({
      method: 'PUT',
      url: `/items/${req.params.id}`,
      data: updates,
      userId: session.seller_user_id,
    });

    const refreshedItem = await mercadoLivreRequest<MercadoLivreItem>({
      method: 'GET',
      url: `/items/${req.params.id}`,
      userId: session.seller_user_id,
    });

    const storedItem = await persistRemoteItem(refreshedItem, {
      sellerUserId: session.seller_user_id,
      source: 'update',
    });

    res.json(storedItem);
  } catch (error) {
    const httpError = toHttpError(error, 'Failed to update the ad on Mercado Livre.');
    res.status(httpError.status).json({ error: httpError.message, details: httpError.details });
  }
});

export default router;
