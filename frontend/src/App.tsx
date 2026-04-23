import axios from 'axios';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import './App.css';
import AdCreateModal from './components/AdCreateModal';
import AdEditModal from './components/AdEditModal';
import MetricCard from './components/MetricCard';
import StatusBadge from './components/StatusBadge';
import ToastStack from './components/ToastStack';
import { API_BASE_URL, api, clearSessionId, getApiErrorMessage, setSessionId } from './lib/api';
import type {
  Ad,
  AdsResponse,
  AdsSummary,
  AuthStatus,
  CategoryAttribute,
  CategoryAttributeDraft,
  CategoryContextResponse,
  CategoryPrediction,
  CreateAdFormState,
  EditAdFormState,
  FiltersState,
  ListingType,
  ToastMessage,
  ValidationIssue,
  ValidationResponse,
} from './types';

const emptySummary: AdsSummary = {
  total: 0,
  active: 0,
  paused: 0,
  lowStock: 0,
  unsynced: 0,
  conflicts: 0,
  remoteChanged: 0,
  inventoryValue: 0,
};

const initialFilters: FiltersState = {
  search: '',
  status: 'all',
  syncState: 'all',
  stock: 'all',
  sort: 'updated_desc',
};

const initialCreateForm: CreateAdFormState = {
  title: '',
  category_id: '',
  listing_type_id: '',
  price: '',
  available_quantity: '',
  condition: 'new',
  currency_id: 'BRL',
  buying_mode: 'buy_it_now',
  pictures: '',
};

const initialEditForm: EditAdFormState = {
  title: '',
  price: '',
  available_quantity: '',
};

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});
const SYNC_REQUEST_TIMEOUT_MS = 120_000;
const DEFAULT_TITLE_MIN_LENGTH = 35;
const DEFAULT_TITLE_MAX_LENGTH = 60;

const formatDateTime = (value?: string): string => {
  if (!value) {
    return 'Nao registrado';
  }

  const parsedValue = new Date(value);

  if (Number.isNaN(parsedValue.getTime())) {
    return 'Nao registrado';
  }

  return dateFormatter.format(parsedValue);
};

const buildPicturesPayload = (value: string): string[] => {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeComparableText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const cleanTitleSpacing = (value: string) => value.replace(/\s+/g, ' ').trim();

const titleAttributePriority = (attribute: CategoryAttribute): number => {
  const normalizedKey = `${normalizeComparableText(attribute.id)} ${normalizeComparableText(attribute.name)}`;

  if (/brand|marca/.test(normalizedKey)) return 1;
  if (/model|modelo/.test(normalizedKey)) return 2;
  if (/line|linha/.test(normalizedKey)) return 3;
  if (/technology|tecnologia|lighting|iluminacao/.test(normalizedKey)) return 4;
  if (/socket|soquete|base/.test(normalizedKey)) return 5;
  if (/shape|forma|format/.test(normalizedKey)) return 6;
  if (/power|potencia|watt|voltage|tensao|voltagem|size|tamanho|capacity|capacidade/.test(normalizedKey)) return 7;
  if (/color|cor/.test(normalizedKey)) return 8;
  return 20;
};

const getResolvedAttributeValue = (
  attribute: CategoryAttribute,
  draft: CategoryAttributeDraft | undefined
): string => {
  if (attribute.fixed && attribute.values.length > 0) {
    return attribute.values[0].name.trim();
  }

  if (!draft?.value.trim()) {
    return '';
  }

  const matchedOption = attribute.values.find(
    (option) => option.id === draft.value || option.name === draft.value
  );
  const baseValue = matchedOption?.name || draft.value.trim();

  if (attribute.value_type === 'number_unit') {
    const matchedUnit = attribute.allowed_units.find(
      (unit) => unit.id === draft.unit || unit.name === draft.unit
    );
    const resolvedUnit = matchedUnit?.name || matchedUnit?.id || draft.unit.trim();
    return cleanTitleSpacing(`${baseValue} ${resolvedUnit}`);
  }

  return baseValue;
};

const buildEffectiveCreateTitle = (
  baseTitle: string,
  attributes: CategoryAttribute[],
  drafts: Record<string, CategoryAttributeDraft>,
  selectedCategoryPath: string,
  titleLimit: number
) => {
  const normalizedBaseTitle = cleanTitleSpacing(baseTitle);
  const titleParts = normalizedBaseTitle ? [normalizedBaseTitle] : [];
  const comparableParts = new Set<string>();

  if (normalizedBaseTitle) {
    comparableParts.add(normalizeComparableText(normalizedBaseTitle));
  }

  const relevantAttributes = [...attributes]
    .filter((attribute) => !['GTIN', 'EMPTY_GTIN_REASON'].includes(attribute.id))
    .sort((left, right) => titleAttributePriority(left) - titleAttributePriority(right));

  for (const attribute of relevantAttributes) {
    const resolvedValue = getResolvedAttributeValue(attribute, drafts[attribute.id]);
    const comparableValue = normalizeComparableText(resolvedValue);

    if (!resolvedValue || !comparableValue || comparableParts.has(comparableValue)) {
      continue;
    }

    if (normalizedBaseTitle && normalizeComparableText(normalizedBaseTitle).includes(comparableValue)) {
      continue;
    }

    const candidateTitle = cleanTitleSpacing([...titleParts, resolvedValue].join(' '));

    if (candidateTitle.length > titleLimit) {
      continue;
    }

    titleParts.push(resolvedValue);
    comparableParts.add(comparableValue);

    if (candidateTitle.length >= DEFAULT_TITLE_MIN_LENGTH) {
      break;
    }
  }

  const categoryLeaf = selectedCategoryPath
    .split('>')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .at(-1);

  if (categoryLeaf) {
    const comparableLeaf = normalizeComparableText(categoryLeaf);
    const candidateTitle = cleanTitleSpacing([...titleParts, categoryLeaf].join(' '));

    if (comparableLeaf && !comparableParts.has(comparableLeaf) && candidateTitle.length <= titleLimit) {
      titleParts.push(categoryLeaf);
    }
  }

  return cleanTitleSpacing(titleParts.join(' ')).slice(0, titleLimit).trim();
};

const hasAttributeDraftValue = (
  drafts: Record<string, CategoryAttributeDraft>,
  attributeId: string
) => Boolean(drafts[attributeId]?.value.trim());

const buildAttributePayload = (
  attributes: CategoryAttribute[],
  drafts: Record<string, CategoryAttributeDraft>
) => {
  return attributes
    .map((attribute) => {
      const draft = drafts[attribute.id];

      if (attribute.fixed && attribute.values.length > 0) {
        return {
          id: attribute.id,
          value_id: attribute.values[0].id,
          value_name: attribute.values[0].name,
        };
      }

      if (!draft || !draft.value.trim()) {
        return null;
      }

      if (attribute.value_type === 'number_unit') {
        if (!draft.unit.trim()) {
          return null;
        }

        const matchedUnit = attribute.allowed_units.find(
          (unit) => unit.id === draft.unit || unit.name === draft.unit
        );
        const resolvedUnit = matchedUnit?.name || matchedUnit?.id || draft.unit.trim();

        return {
          id: attribute.id,
          value_name: `${draft.value.trim()} ${resolvedUnit}`.trim(),
        };
      }

      const matchedOption = attribute.values.find(
        (option) => option.id === draft.value || option.name === draft.value
      );

      if (matchedOption) {
        return {
          id: attribute.id,
          value_id: matchedOption.id,
          value_name: matchedOption.name,
        };
      }

      return {
        id: attribute.id,
        value_name: draft.value.trim(),
      };
    })
    .filter(Boolean);
};

const extractValidationIssues = (error: unknown): ValidationIssue[] => {
  if (axios.isAxiosError(error) && Array.isArray(error.response?.data?.issues)) {
    return error.response?.data?.issues as ValidationIssue[];
  }

  return [];
};

function App() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [summary, setSummary] = useState<AdsSummary>(emptySummary);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({ authenticated: false });
  const [authFeedback] = useState(() => {
    const searchParams = new URLSearchParams(window.location.search);

    return {
      state: searchParams.get('auth'),
      message: searchParams.get('message'),
      sessionId: searchParams.get('session_id'),
    };
  });
  const [filters, setFilters] = useState<FiltersState>(initialFilters);
  const [createForm, setCreateForm] = useState<CreateAdFormState>(initialCreateForm);
  const [editForm, setEditForm] = useState<EditAdFormState>(initialEditForm);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [listingTypes, setListingTypes] = useState<ListingType[]>([]);
  const [categorySuggestions, setCategorySuggestions] = useState<CategoryPrediction[]>([]);
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, CategoryAttributeDraft>>({});
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [selectedCategoryPath, setSelectedCategoryPath] = useState('');
  const [categoryTitleLimit, setCategoryTitleLimit] = useState(DEFAULT_TITLE_MAX_LENGTH);
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>('');
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingAds, setIsLoadingAds] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [isLoadingCategorySuggestions, setIsLoadingCategorySuggestions] = useState(false);
  const [isLoadingCategoryContext, setIsLoadingCategoryContext] = useState(false);
  const [isValidatingCreate, setIsValidatingCreate] = useState(false);
  const [hasLoadedAds, setHasLoadedAds] = useState(false);

  const deferredSearch = useDeferredValue(filters.search.trim());
  const hasAutoSyncedFromAuth = useRef(false);
  const nextToastId = useRef(1);
  const effectiveCreateTitle = buildEffectiveCreateTitle(
    createForm.title,
    categoryAttributes,
    attributeDrafts,
    selectedCategoryPath,
    categoryTitleLimit
  );

  const pushToast = (tone: ToastMessage['tone'], title: string, description?: string) => {
    const toastId = nextToastId.current;
    nextToastId.current += 1;
    setToasts((current) => [...current, { id: toastId, tone, title, description }]);
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  };

  const resetCategoryFlow = () => {
    setListingTypes([]);
    setCategoryAttributes([]);
    setAttributeDrafts({});
    setValidationIssues([]);
    setSelectedCategoryPath('');
    setCategoryTitleLimit(DEFAULT_TITLE_MAX_LENGTH);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreateForm(initialCreateForm);
    setListingTypes([]);
    setCategorySuggestions([]);
    setCategoryAttributes([]);
    setAttributeDrafts({});
    setValidationIssues([]);
    setSelectedCategoryPath('');
    setCategoryTitleLimit(DEFAULT_TITLE_MAX_LENGTH);
  };

  const fetchAuthStatus = async () => {
    setIsLoadingAuth(true);

    try {
      const response = await api.get<AuthStatus>('/auth/status');
      if (response.data.session_id) {
        setSessionId(response.data.session_id);
      } else if (!response.data.authenticated) {
        clearSessionId();
      }
      setAuthStatus(response.data);
    } catch (error) {
      setAuthStatus({ authenticated: false });
      clearSessionId();
      pushToast('error', 'Falha ao validar sessao', getApiErrorMessage(error));
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const fetchAds = async (showErrorToast = true) => {
    setIsLoadingAds(true);

    try {
      const response = await api.get<AdsResponse>('/ads', {
        params: {
          search: deferredSearch,
          status: filters.status,
          sync_state: filters.syncState,
          stock: filters.stock,
          sort: filters.sort,
        },
      });

      setAds(response.data.items);
      setSummary(response.data.summary);
    } catch (error) {
      if (showErrorToast) {
        pushToast('error', 'Falha ao carregar anuncios', getApiErrorMessage(error));
      }
    } finally {
      setIsLoadingAds(false);
      setHasLoadedAds(true);
    }
  };

  const syncAds = async () => {
    setIsSyncing(true);

    try {
      const response = await api.post<AdsResponse>('/ads/sync', undefined, {
        timeout: SYNC_REQUEST_TIMEOUT_MS,
      });
      setAds(response.data.items);
      setSummary(response.data.summary);
      setLastSyncedAt(response.data.syncedAt ?? new Date().toISOString());

      if (response.data.warnings && response.data.warnings.length > 0) {
        pushToast('info', 'Sincronizacao com alertas', response.data.warnings[0]);
      } else {
        pushToast('success', 'Sincronizacao concluida', 'Os anuncios locais foram atualizados.');
      }
    } catch (error) {
      pushToast('error', 'Falha ao sincronizar', getApiErrorMessage(error));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleConnectSeller = async () => {
    try {
      const response = await api.get<{ url: string }>('/auth/login', {
        params: {
          frontend_url: window.location.origin,
        },
      });
      window.location.href = response.data.url;
    } catch (error) {
      pushToast('error', 'Falha ao iniciar autenticacao', getApiErrorMessage(error));
    }
  };

  const handleLogout = async () => {
    try {
      await api.delete('/auth/session');
    } catch {
      // Intencionalmente silencioso: a sessao local sera descartada mesmo se a API falhar.
    } finally {
      clearSessionId();
      setAuthStatus({ authenticated: false });
      setAds([]);
      setSummary(emptySummary);
      setLastSyncedAt('');
      setSelectedAd(null);
      closeCreateModal();
      pushToast('success', 'Sessao encerrada', 'A sessao isolada deste navegador foi removida.');
    }
  };

  const handleCreateFieldChange = (field: keyof CreateAdFormState, value: string) => {
    setCreateForm((current) => ({
      ...current,
      [field]: value,
    }));

    if (field === 'title') {
      setCategorySuggestions([]);
      setValidationIssues([]);
    }

    if (field === 'category_id') {
      resetCategoryFlow();
    }

    if (field === 'listing_type_id') {
      setValidationIssues([]);
    }
  };

  const handleAttributeChange = (attributeId: string, value: string, unit = '') => {
    setAttributeDrafts((current) => ({
      ...current,
      [attributeId]: {
        value,
        unit,
      },
    }));
    setValidationIssues([]);
  };

  const handleEditFieldChange = (field: keyof EditAdFormState, value: string) => {
    setEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleOpenEditModal = (ad: Ad) => {
    setSelectedAd(ad);
    setEditForm({
      title: ad.title,
      price: String(ad.price),
      available_quantity: String(ad.available_quantity),
    });
  };

  const buildCreatePayload = () => ({
    title: effectiveCreateTitle,
    category_id: createForm.category_id,
    listing_type_id: createForm.listing_type_id,
    price: Number(createForm.price),
    available_quantity: Number(createForm.available_quantity),
    condition: createForm.condition,
    currency_id: createForm.currency_id,
    buying_mode: createForm.buying_mode,
    pictures: buildPicturesPayload(createForm.pictures),
    attributes: buildAttributePayload(categoryAttributes, attributeDrafts),
  });

  const validateCreateAd = async (showSuccessToast = true) => {
    // Validação local antes de chamar o backend
    if (createForm.title.trim().length < 20) {
      pushToast('error', 'Título muito curto', 'Inclua marca, modelo e características. Ex: "Notebook Dell Inspiron 15 Core i5 8GB"');
      return false;
    }

    if (!createForm.category_id.trim()) {
      pushToast('error', 'Categoria obrigatória', 'Carregue uma categoria antes de validar.');
      return false;
    }

    if (!createForm.listing_type_id.trim()) {
      pushToast('error', 'Tipo de anúncio obrigatório', 'Selecione um tipo de anúncio.');
      return false;
    }

    // Checar atributos obrigatórios não preenchidos
    const missingRequired = categoryAttributes
      .filter((attr) => attr.required && !attr.fixed)
      .filter((attr) => {
        const draft = attributeDrafts[attr.id];
        return !draft || !draft.value.trim();
      });

    if (missingRequired.length > 0) {
      const names = missingRequired.map((a) => a.name).join(', ');
      pushToast('error', 'Atributos obrigatórios', `Preencha: ${names}`);
      setValidationIssues(
        missingRequired.map((a) => ({
          code: 'missing_required',
          message: `Campo obrigatório não preenchido`,
          references: [a.name],
        }))
      );
      return false;
    }

    setIsValidatingCreate(true);

    try {
      const response = await api.post<ValidationResponse>('/ads/validate', buildCreatePayload());
      setValidationIssues(response.data.issues ?? []);

      if (showSuccessToast) {
        pushToast('success', 'Payload validado', 'O anuncio passou pela validacao do Mercado Livre.');
      }

      return true;
    } catch (error) {
      const issues = extractValidationIssues(error);
      setValidationIssues(issues);
      pushToast('error', 'Falha na validacao', getApiErrorMessage(error));
      return false;
    } finally {
      setIsValidatingCreate(false);
    }
  };

  void validateCreateAd;

  const validateCreateAdEnhanced = async (showSuccessToast = true) => {
    if (effectiveCreateTitle.length < DEFAULT_TITLE_MIN_LENGTH) {
      pushToast(
        'error',
        'Titulo muito curto',
        `O titulo montado ainda esta fraco para publicar: "${effectiveCreateTitle || 'vazio'}".`
      );
      return false;
    }

    if (!createForm.category_id.trim()) {
      pushToast('error', 'Categoria obrigatoria', 'Carregue uma categoria antes de validar.');
      return false;
    }

    if (!createForm.listing_type_id.trim()) {
      pushToast('error', 'Tipo de anuncio obrigatorio', 'Selecione um tipo de anuncio.');
      return false;
    }

    if (buildPicturesPayload(createForm.pictures).length === 0) {
      pushToast('error', 'Imagem obrigatoria', 'Adicione pelo menos uma imagem valida antes de publicar.');
      return false;
    }

    const missingRequired = categoryAttributes
      .filter((attr) => attr.required && !attr.fixed)
      .filter((attr) => {
        if (attr.id === 'GTIN') {
          return !hasAttributeDraftValue(attributeDrafts, 'GTIN') && !hasAttributeDraftValue(attributeDrafts, 'EMPTY_GTIN_REASON');
        }

        if (attr.id === 'EMPTY_GTIN_REASON') {
          return !hasAttributeDraftValue(attributeDrafts, 'GTIN') && !hasAttributeDraftValue(attributeDrafts, 'EMPTY_GTIN_REASON');
        }

        const draft = attributeDrafts[attr.id];
        return !draft || !draft.value.trim();
      });

    if (missingRequired.length > 0) {
      const deduplicatedMissingRequired = missingRequired.filter(
        (attribute, index, items) =>
          !(
            ['GTIN', 'EMPTY_GTIN_REASON'].includes(attribute.id) &&
            items.slice(0, index).some((candidate) => ['GTIN', 'EMPTY_GTIN_REASON'].includes(candidate.id))
          )
      );
      const names = deduplicatedMissingRequired.map((attribute) => attribute.name).join(', ');
      pushToast('error', 'Atributos obrigatorios', `Preencha: ${names}`);
      setValidationIssues(
        deduplicatedMissingRequired.map((attribute) => ({
          code: 'missing_required',
          message:
            ['GTIN', 'EMPTY_GTIN_REASON'].includes(attribute.id)
              ? 'Preencha o GTIN ou informe um motivo de GTIN vazio'
              : 'Campo obrigatorio nao preenchido',
          references: [attribute.name],
        }))
      );
      return false;
    }

    setIsValidatingCreate(true);

    try {
      const response = await api.post<ValidationResponse>('/ads/validate', buildCreatePayload());
      setValidationIssues(response.data.issues ?? []);

      if (showSuccessToast) {
        pushToast('success', 'Payload validado', 'O anuncio passou pela validacao do Mercado Livre.');
      }

      return true;
    } catch (error) {
      const issues = extractValidationIssues(error);
      const titleIssue = issues.find((issue) => issue.code === 'item.title.minimum_length');
      setValidationIssues(issues);

      if (titleIssue) {
        pushToast(
          'error',
          'Titulo rejeitado pelo Mercado Livre',
          `Ajuste o titulo com mais caracteristicas. Titulo enviado: "${effectiveCreateTitle}".`
        );
        return false;
      }

      pushToast('error', 'Falha na validacao', getApiErrorMessage(error));
      return false;
    } finally {
      setIsValidatingCreate(false);
    }
  };

  const handleCreateAd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmittingCreate(true);

    try {
      const isValid = await validateCreateAdEnhanced(false);

      if (!isValid) {
        setIsSubmittingCreate(false); // adicionado para liberar o botão caso a validação falhe
        return;
      }

      await api.post('/ads', buildCreatePayload());

      closeCreateModal();
      pushToast('success', 'Anuncio criado', 'O item foi publicado e salvo no painel local.');
      await fetchAds(false);
      await fetchAuthStatus();
    } catch (error) {
      pushToast('error', 'Falha ao criar anuncio', getApiErrorMessage(error));
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleUpdateAd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedAd) {
      return;
    }

    setIsSubmittingEdit(true);

    try {
      const response = await api.put<Ad>(`/ads/${selectedAd.ml_id}`, {
        title: editForm.title,
        price: Number(editForm.price),
        available_quantity: Number(editForm.available_quantity),
        expected_updated_at: selectedAd.updatedAt,
      });

      setAds((current) =>
        current.map((ad) => (ad.ml_id === response.data.ml_id ? response.data : ad))
      );
      setSelectedAd(null);
      pushToast('success', 'Anuncio atualizado', 'Preco e estoque foram atualizados com sucesso.');
      await fetchAds(false);
    } catch (error) {
      pushToast('error', 'Falha ao atualizar anuncio', getApiErrorMessage(error));
      await fetchAds(false);
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const loadCategorySuggestions = async () => {
    if (createForm.title.trim().length < 3) {
      pushToast('info', 'Titulo curto', 'Informe pelo menos 3 caracteres para sugerir categorias.');
      return;
    }

    setIsLoadingCategorySuggestions(true);

    try {
      const response = await api.get<{ items: CategoryPrediction[] }>('/ads/category-predictor', {
        params: {
          title: createForm.title.trim(),
        },
      });

      setCategorySuggestions(response.data.items);

      if (response.data.items.length === 0) {
        pushToast('info', 'Sem sugestoes', 'Nenhuma categoria foi sugerida para esse titulo.');
      }
    } catch (error) {
      pushToast('error', 'Falha ao sugerir categoria', getApiErrorMessage(error));
    } finally {
      setIsLoadingCategorySuggestions(false);
    }
  };

  const loadCategoryContext = async (categoryIdOverride?: string) => {
    const categoryId = (categoryIdOverride ?? createForm.category_id).trim().toUpperCase();

    if (!categoryId) {
      pushToast('info', 'Informe uma categoria', 'A categoria eh obrigatoria para carregar os dados de publicacao.');
      return;
    }

    setIsLoadingCategoryContext(true);

    try {
      const response = await api.get<CategoryContextResponse>('/ads/category-context', {
        params: {
          category_id: categoryId,
        },
      });

      setCreateForm((current) => ({
        ...current,
        category_id: categoryId,
        listing_type_id:
          current.listing_type_id && response.data.listingTypes.some((item) => item.id === current.listing_type_id)
            ? current.listing_type_id
            : response.data.listingTypes[0]?.id ?? '',
      }));
      setListingTypes(response.data.listingTypes);
      setCategoryAttributes(response.data.attributes);
      setSelectedCategoryPath(response.data.category.path_from_root.map((item) => item.name).join(' > '));
      setCategoryTitleLimit(response.data.category.max_title_length ?? DEFAULT_TITLE_MAX_LENGTH);
      setValidationIssues([]);

      setAttributeDrafts(
        response.data.attributes.reduce<Record<string, CategoryAttributeDraft>>((accumulator, attribute) => {
          if (attribute.fixed && attribute.values.length > 0) {
            accumulator[attribute.id] = {
              value: attribute.values[0].id || attribute.values[0].name,
              unit: attribute.default_unit ?? '',
            };
          } else if (attribute.default_unit) {
            accumulator[attribute.id] = {
              value: '',
              unit: attribute.default_unit,
            };
          } else if (attribute.id === 'EMPTY_GTIN_REASON') {
            const unregisteredOption = attribute.values.find(
              (option) => normalizeComparableText(option.name) === 'no registrado'
            );

            if (unregisteredOption) {
              accumulator[attribute.id] = {
                value: unregisteredOption.id || unregisteredOption.name,
                unit: '',
              };
            }
          }

          return accumulator;
        }, {})
      );

      if (response.data.listingTypes.length === 0) {
        pushToast('info', 'Sem tipos disponiveis', 'A conta nao retornou listing types para essa categoria.');
      } else {
        pushToast('success', 'Categoria carregada', 'Tipos de anuncio e atributos foram atualizados.');
      }
    } catch (error) {
      pushToast('error', 'Falha ao carregar categoria', getApiErrorMessage(error));
    } finally {
      setIsLoadingCategoryContext(false);
    }
  };

  const handleSelectCategorySuggestion = (suggestion: CategoryPrediction) => {
    setCreateForm((current) => ({
      ...current,
      category_id: suggestion.category_id,
      listing_type_id: '',
    }));
    setCategorySuggestions((current) => current);
    resetCategoryFlow();
    void loadCategoryContext(suggestion.category_id);
  };

  useEffect(() => {
    let active = true;
    const appendToast = (tone: ToastMessage['tone'], title: string, description?: string) => {
      const toastId = nextToastId.current;
      nextToastId.current += 1;
      setToasts((current) => [...current, { id: toastId, tone, title, description }]);
    };

    if (authFeedback.sessionId) {
      setSessionId(authFeedback.sessionId);
    }

    if (authFeedback.state === 'success') {
      appendToast('success', 'Conta autenticada', 'A sessao do vendedor foi conectada com sucesso.');
    }

    if (authFeedback.state === 'error') {
      appendToast(
        'error',
        'Falha na autenticacao',
        authFeedback.message || 'Nao foi possivel concluir a autenticacao.'
      );
    }

    if (authFeedback.state) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const loadStatus = async () => {
      setIsLoadingAuth(true);

      try {
        const response = await api.get<AuthStatus>('/auth/status');

        if (!active) {
          return;
        }

        if (response.data.session_id) {
          setSessionId(response.data.session_id);
        } else if (!response.data.authenticated) {
          clearSessionId();
        }
        setAuthStatus(response.data);
      } catch (error) {
        if (!active) {
          return;
        }

        setAuthStatus({ authenticated: false });
        clearSessionId();
        appendToast('error', 'Falha ao validar sessao', getApiErrorMessage(error));
      } finally {
        if (active) {
          setIsLoadingAuth(false);
        }
      }
    };

    void loadStatus();

    return () => {
      active = false;
    };
  }, [authFeedback.message, authFeedback.sessionId, authFeedback.state]);

  useEffect(() => {
    let active = true;
    const appendToast = (tone: ToastMessage['tone'], title: string, description?: string) => {
      const toastId = nextToastId.current;
      nextToastId.current += 1;
      setToasts((current) => [...current, { id: toastId, tone, title, description }]);
    };

    const timeoutId = window.setTimeout(async () => {
      setIsLoadingAds(true);

      try {
        const response = await api.get<AdsResponse>('/ads', {
          params: {
            search: deferredSearch,
            status: filters.status,
            sync_state: filters.syncState,
            stock: filters.stock,
            sort: filters.sort,
          },
        });

        if (!active) {
          return;
        }

        setAds(response.data.items);
        setSummary(response.data.summary);
      } catch (error) {
        if (active) {
          appendToast('error', 'Falha ao carregar anuncios', getApiErrorMessage(error));
        }
      } finally {
        if (active) {
          setIsLoadingAds(false);
          setHasLoadedAds(true);
        }
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [deferredSearch, filters.status, filters.syncState, filters.stock, filters.sort]);

  useEffect(() => {
    if (authFeedback.state !== 'success' || !authStatus.authenticated || hasAutoSyncedFromAuth.current) {
      return;
    }

    hasAutoSyncedFromAuth.current = true;
    const appendToast = (tone: ToastMessage['tone'], title: string, description?: string) => {
      const toastId = nextToastId.current;
      nextToastId.current += 1;
      setToasts((current) => [...current, { id: toastId, tone, title, description }]);
    };

    void (async () => {
      setIsSyncing(true);

      try {
        const response = await api.post<AdsResponse>('/ads/sync', undefined, {
          timeout: SYNC_REQUEST_TIMEOUT_MS,
        });
        setAds(response.data.items);
        setSummary(response.data.summary);
        setLastSyncedAt(response.data.syncedAt ?? new Date().toISOString());

        if (response.data.warnings && response.data.warnings.length > 0) {
          appendToast('info', 'Sincronizacao com alertas', response.data.warnings[0]);
        } else {
          appendToast('success', 'Sincronizacao concluida', 'Os anuncios locais foram atualizados.');
        }
      } catch (error) {
        appendToast('error', 'Falha ao sincronizar', getApiErrorMessage(error));
      } finally {
        setIsSyncing(false);
      }
    })();
  }, [authFeedback.state, authStatus.authenticated]);

  useEffect(() => {
    if (toasts.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== toasts[0].id));
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [toasts]);

  const visibleCountLabel =
    isLoadingAds && !hasLoadedAds ? 'Carregando anuncios...' : `${ads.length} itens na listagem`;

  return (
    <>
      <div className="page-shell">
        <div className="page-background" />

        <header className="hero-panel">
          <div className="hero-panel__copy">
            <span className="section-tag">Painel do vendedor</span>
            <h1>Operacao de anuncios do Mercado Livre em um unico lugar</h1>
            <p>
              O fluxo de publicacao agora sugere categoria, carrega tipos validos da conta e valida
              o payload antes de criar o anuncio.
            </p>

            <div className="hero-panel__actions">
              <button type="button" className="primary-button" onClick={handleConnectSeller}>
                {authStatus.authenticated ? 'Reconectar conta' : 'Autenticar vendedor'}
              </button>
              <button type="button" className="secondary-button" onClick={() => void syncAds()} disabled={isSyncing}>
                {isSyncing ? 'Sincronizando...' : 'Sincronizar anuncios'}
              </button>
              <button type="button" className="ghost-button" onClick={() => setIsCreateModalOpen(true)}>
                Novo anuncio
              </button>
              {authStatus.authenticated ? (
                <button type="button" className="ghost-button" onClick={() => void handleLogout()}>
                  Encerrar sessao
                </button>
              ) : null}
            </div>
          </div>

          <aside className="hero-panel__side">
            <section className="seller-card">
              <header className="seller-card__header">
                <span className="section-tag">Sessao da conta</span>
                <span className={`connection-dot ${authStatus.authenticated ? 'is-online' : 'is-offline'}`} />
              </header>

              {isLoadingAuth ? (
                <p className="seller-card__text">Validando sessao do vendedor...</p>
              ) : authStatus.authenticated && authStatus.seller ? (
                <>
                  <strong className="seller-card__title">{authStatus.seller.nickname}</strong>
                  <p className="seller-card__text">{authStatus.seller.email || 'Email nao informado'}</p>
                  <dl className="seller-card__meta">
                    <div>
                      <dt>Tipo</dt>
                      <dd>{authStatus.seller.user_type}</dd>
                    </div>
                    <div>
                      <dt>Pontos</dt>
                      <dd>{authStatus.seller.points}</dd>
                    </div>
                    <div>
                      <dt>Sessao expira</dt>
                      <dd>{formatDateTime(authStatus.expires_at)}</dd>
                    </div>
                  </dl>
                  <p className="seller-card__text">Sessao isolada por navegador. Outros acessos nao reutilizam esta conta automaticamente.</p>
                </>
              ) : (
                <>
                  <strong className="seller-card__title">Conta nao autenticada</strong>
                  <p className="seller-card__text">
                    Conecte uma conta para publicar, editar e sincronizar anuncios do marketplace.
                  </p>
                </>
              )}
            </section>

            <section className="delivery-card">
              <span className="section-tag">Deploy readiness</span>
              <ul className="delivery-card__list">
                <li>Preditor de categoria pelo titulo.</li>
                <li>Sessao isolada por navegador e vendedor.</li>
                <li>Tipos de anuncio carregados da conta autenticada.</li>
                <li>Atributos dinamicos por categoria.</li>
                <li>Validacao do payload antes do `POST /items`.</li>
                <li>Conflito basico com optimistic locking na edicao.</li>
              </ul>
              <p className="delivery-card__hint">
                API base atual: <code>{API_BASE_URL}</code>
              </p>
            </section>
          </aside>
        </header>

        <section className="metrics-grid">
          <MetricCard label="Total de anuncios" value={String(summary.total)} hint="Volume total em cache local" accent="gold" />
          <MetricCard label="Anuncios ativos" value={String(summary.active)} hint="Itens com status active" accent="green" />
          <MetricCard label="Estoque baixo" value={String(summary.lowStock)} hint="Itens com ate 5 unidades" accent="blue" />
          <MetricCard label="Itens divergentes" value={String(summary.unsynced)} hint={`${summary.remoteChanged} mudancas remotas e ${summary.conflicts} conflitos`} accent="slate" />
          <MetricCard label="Conflitos locais" value={String(summary.conflicts)} hint="Bloqueios por concorrencia otimista" accent="blue" />
          <MetricCard label="Valor do inventario" value={currencyFormatter.format(summary.inventoryValue)} hint="Preco x estoque em cache" accent="gold" />
        </section>

        <section className="toolbar-panel">
          <div className="toolbar-panel__heading">
            <div>
              <span className="section-tag">Gestao da listagem</span>
              <h2>Filtrar e agir sobre os anuncios</h2>
            </div>
            <p>{visibleCountLabel}</p>
          </div>

          <div className="filters-grid">
            <label className="field">
              <span>Busca</span>
              <input
                value={filters.search}
                onChange={(event) =>
                  startTransition(() =>
                    setFilters((current) => ({
                      ...current,
                      search: event.target.value,
                    }))
                  )
                }
                placeholder="Buscar por titulo ou SKU visual"
              />
            </label>

            <label className="field">
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
              >
                <option value="all">Todos</option>
                <option value="active">Ativos</option>
                <option value="paused">Pausados</option>
                <option value="closed">Encerrados</option>
              </select>
            </label>

            <label className="field">
              <span>Sincronizacao</span>
              <select
                value={filters.syncState}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    syncState: event.target.value,
                  }))
                }
              >
                <option value="all">Todos</option>
                <option value="synced">Sincronizados</option>
                <option value="remote_changed">Mudanca remota</option>
                <option value="conflict">Conflito local</option>
                <option value="missing_remote">Divergentes</option>
              </select>
            </label>

            <label className="field">
              <span>Estoque</span>
              <select
                value={filters.stock}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    stock: event.target.value,
                  }))
                }
              >
                <option value="all">Todos</option>
                <option value="low">Estoque baixo</option>
                <option value="empty">Sem estoque</option>
              </select>
            </label>

            <label className="field">
              <span>Ordenacao</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    sort: event.target.value,
                  }))
                }
              >
                <option value="updated_desc">Mais recentes</option>
                <option value="updated_asc">Mais antigos</option>
                <option value="price_desc">Maior preco</option>
                <option value="price_asc">Menor preco</option>
                <option value="stock_desc">Maior estoque</option>
                <option value="stock_asc">Menor estoque</option>
                <option value="title_asc">Titulo A-Z</option>
              </select>
            </label>
          </div>

          <div className="toolbar-panel__footer">
            <div className="toolbar-panel__meta">
              <span>Ultima sincronizacao</span>
              <strong>{lastSyncedAt ? formatDateTime(lastSyncedAt) : 'Ainda nao executada nesta sessao'}</strong>
            </div>

            <div className="toolbar-panel__buttons">
              <button type="button" className="ghost-button" onClick={() => void fetchAuthStatus()}>
                Atualizar sessao
              </button>
              <button type="button" className="ghost-button" onClick={() => void fetchAds()}>
                Recarregar lista local
              </button>
            </div>
          </div>
        </section>

        <section className="content-panel">
          <header className="content-panel__header">
            <div>
              <span className="section-tag">Operacao</span>
              <h2>Catalogo sincronizado</h2>
            </div>
            <div className="content-panel__actions">
              <button type="button" className="secondary-button" onClick={() => setIsCreateModalOpen(true)}>
                Criar anuncio
              </button>
            </div>
          </header>

          {isLoadingAds && !hasLoadedAds ? (
            <div className="empty-state">
              <strong>Carregando anuncios do banco local...</strong>
              <p>Assim que os dados chegarem, o painel libera filtros, metricas e edicao rapida.</p>
            </div>
          ) : ads.length === 0 ? (
            <div className="empty-state">
              <strong>Nenhum anuncio encontrado</strong>
              <p>
                Autentique a conta, sincronize os anuncios existentes ou publique um item novo para iniciar
                a base local.
              </p>
              <div className="empty-state__actions">
                <button type="button" className="primary-button" onClick={handleConnectSeller}>
                  Autenticar conta
                </button>
                <button type="button" className="secondary-button" onClick={() => setIsCreateModalOpen(true)}>
                  Criar anuncio
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="table-shell">
                <table className="ads-table">
                  <thead>
                    <tr>
                      <th>Anuncio</th>
                      <th>ID ML</th>
                      <th>Preco</th>
                      <th>Estoque</th>
                      <th>Status</th>
                      <th>Sync</th>
                      <th>Atualizado</th>
                      <th>Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ads.map((ad) => (
                      <tr key={ad._id}>
                        <td>
                          <div className="table-title-cell">
                            {ad.thumbnail ? <img src={ad.thumbnail} alt="" className="table-thumb" /> : null}
                            <div>
                              <strong>{ad.title}</strong>
                              <span>{ad.category_id || 'Categoria nao informada'}</span>
                              {ad.sync_note || ad.last_error ? (
                                <p className="table-inline-note">{ad.sync_note || ad.last_error}</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="mono-cell">{ad.ml_id}</td>
                        <td>{currencyFormatter.format(ad.price)}</td>
                        <td>{ad.available_quantity} un.</td>
                        <td>
                          <StatusBadge value={ad.status} />
                        </td>
                        <td>
                          <StatusBadge value={ad.sync_state} kind="sync" />
                        </td>
                        <td>{formatDateTime(ad.updatedAt || ad.last_sync)}</td>
                        <td>
                          <div className="table-actions">
                            <button type="button" className="link-button" onClick={() => handleOpenEditModal(ad)}>
                              Editar
                            </button>
                            {ad.permalink ? (
                              <a className="link-button" href={ad.permalink} target="_blank" rel="noreferrer">
                                Ver no ML
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ads-cards">
                {ads.map((ad) => (
                  <article key={ad._id} className="ad-card">
                    <div className="ad-card__top">
                      <div>
                        <h3>{ad.title}</h3>
                        <p>{ad.ml_id}</p>
                      </div>
                      <StatusBadge value={ad.status} />
                    </div>

                    <dl className="ad-card__meta">
                      <div>
                        <dt>Preco</dt>
                        <dd>{currencyFormatter.format(ad.price)}</dd>
                      </div>
                      <div>
                        <dt>Estoque</dt>
                        <dd>{ad.available_quantity} un.</dd>
                      </div>
                      <div>
                        <dt>Sincronizacao</dt>
                        <dd>
                          <StatusBadge value={ad.sync_state} kind="sync" />
                        </dd>
                      </div>
                      <div>
                        <dt>Atualizado</dt>
                        <dd>{formatDateTime(ad.updatedAt || ad.last_sync)}</dd>
                      </div>
                    </dl>

                    {ad.sync_note || ad.last_error ? (
                      <p className="ad-card__note">{ad.sync_note || ad.last_error}</p>
                    ) : null}

                    <div className="ad-card__actions">
                      <button type="button" className="secondary-button" onClick={() => handleOpenEditModal(ad)}>
                        Editar
                      </button>
                      {ad.permalink ? (
                        <a className="ghost-button" href={ad.permalink} target="_blank" rel="noreferrer">
                          Abrir no ML
                        </a>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </div>

      <AdCreateModal
        open={isCreateModalOpen}
        form={createForm}
        listingTypes={listingTypes}
        categorySuggestions={categorySuggestions}
        categoryAttributes={categoryAttributes}
        attributeDrafts={attributeDrafts}
        validationIssues={validationIssues}
        selectedCategoryPath={selectedCategoryPath}
        isSubmitting={isSubmittingCreate}
        isValidating={isValidatingCreate}
        isLoadingCategorySuggestions={isLoadingCategorySuggestions}
        isLoadingCategoryContext={isLoadingCategoryContext}
        onClose={closeCreateModal}
        onFieldChange={handleCreateFieldChange}
        onAttributeChange={handleAttributeChange}
        onSubmit={handleCreateAd}
        onLoadCategorySuggestions={loadCategorySuggestions}
        onSelectCategory={handleSelectCategorySuggestion}
        onLoadCategoryContext={() => void loadCategoryContext()}
        effectiveTitle={effectiveCreateTitle}
        titleLimit={categoryTitleLimit}
        onValidate={() => void validateCreateAdEnhanced(true)}
      />

      <AdEditModal
        ad={selectedAd}
        open={Boolean(selectedAd)}
        form={editForm}
        isSubmitting={isSubmittingEdit}
        onClose={() => setSelectedAd(null)}
        onFieldChange={handleEditFieldChange}
        onSubmit={handleUpdateAd}
      />

      <ToastStack items={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default App;
