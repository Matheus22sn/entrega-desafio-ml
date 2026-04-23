import type { FormEvent } from 'react';
import type {
  CategoryAttribute,
  CategoryAttributeDraft,
  CategoryPrediction,
  CreateAdFormState,
  ListingType,
  ValidationIssue,
} from '../types';

type AdCreateModalProps = {
  open: boolean;
  form: CreateAdFormState;
  listingTypes: ListingType[];
  categorySuggestions: CategoryPrediction[];
  categoryAttributes: CategoryAttribute[];
  attributeDrafts: Record<string, CategoryAttributeDraft>;
  validationIssues: ValidationIssue[];
  selectedCategoryPath: string;
  isSubmitting: boolean;
  isValidating: boolean;
  isLoadingCategorySuggestions: boolean;
  isLoadingCategoryContext: boolean;
  effectiveTitle: string;
  titleLimit: number;
  onClose: () => void;
  onFieldChange: (field: keyof CreateAdFormState, value: string) => void;
  onAttributeChange: (attributeId: string, value: string, unit?: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onLoadCategorySuggestions: () => void;
  onSelectCategory: (suggestion: CategoryPrediction) => void;
  onLoadCategoryContext: () => void;
  onValidate: () => void;
};

const getAttributePlaceholder = (attribute: CategoryAttribute): string => {
  if (attribute.values.length > 0) {
    return 'Selecione ou digite um valor';
  }

  if (attribute.value_type === 'number' || attribute.value_type === 'number_unit') {
    return 'Informe um numero';
  }

  if (attribute.value_type === 'boolean') {
    return 'Selecione';
  }

  return 'Informe um valor';
};

function renderAttributeInput(
  attribute: CategoryAttribute,
  draft: CategoryAttributeDraft | undefined,
  onAttributeChange: (attributeId: string, value: string, unit?: string) => void
) {
  const currentValue = draft?.value ?? '';
  const currentUnit = draft?.unit ?? attribute.default_unit ?? '';

  if (attribute.fixed && attribute.values.length > 0) {
    return (
      <input
        value={attribute.values[0].name}
        readOnly
        aria-readonly="true"
      />
    );
  }

  if (attribute.value_type === 'boolean') {
    return (
      <select value={currentValue} onChange={(event) => onAttributeChange(attribute.id, event.target.value)}>
        <option value="">Selecione</option>
        {/* O Mercado Livre exige os textos "Sim" e "Não" para atributos booleanos no Brasil */}
        <option value="Sim">Sim</option>
        <option value="Não">Não</option>
      </select>
    );
  }

  if (attribute.value_type === 'number_unit') {
    return (
      <div className="field__row">
        <input
          type="number"
          value={currentValue}
          onChange={(event) => onAttributeChange(attribute.id, event.target.value, currentUnit)}
          placeholder={getAttributePlaceholder(attribute)}
        />
        <select
          value={currentUnit}
          onChange={(event) => onAttributeChange(attribute.id, currentValue, event.target.value)}
        >
          <option value="">Unidade</option>
          {attribute.allowed_units.map((unit) => (
            <option key={unit.id || unit.name} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (attribute.values.length > 0 && attribute.values.length <= 100) {
    const listId = `datalist-${attribute.id}`;
    return (
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          list={listId}
          type="text"
          value={currentValue}
          onChange={(event) => onAttributeChange(attribute.id, event.target.value)}
          placeholder={getAttributePlaceholder(attribute)}
          maxLength={attribute.value_max_length ?? undefined}
          autoComplete="off"
        />
        <datalist id={listId}>
          {attribute.values.map((value) => (
            <option key={value.id || value.name} value={value.name} />
          ))}
        </datalist>
      </div>
    );
  }

  return (
    <input
      type={attribute.value_type === 'number' ? 'number' : 'text'}
      value={currentValue}
      onChange={(event) => onAttributeChange(attribute.id, event.target.value)}
      placeholder={getAttributePlaceholder(attribute)}
      maxLength={attribute.value_max_length ?? undefined}
    />
  );
}

function AdCreateModal({
  open,
  form,
  listingTypes,
  categorySuggestions,
  categoryAttributes,
  attributeDrafts,
  validationIssues,
  selectedCategoryPath,
  isSubmitting,
  isValidating,
  isLoadingCategorySuggestions,
  isLoadingCategoryContext,
  effectiveTitle,
  titleLimit,
  onClose,
  onFieldChange,
  onAttributeChange,
  onSubmit,
  onLoadCategorySuggestions,
  onSelectCategory,
  onLoadCategoryContext,
  onValidate,
}: AdCreateModalProps) {
  if (!open) {
    return null;
  }

  const visibleAttributes = categoryAttributes.filter(
    (attribute) => !attribute.hidden || attribute.id === 'GTIN' || attribute.id === 'EMPTY_GTIN_REASON'
  );
  const requiredAttributes = visibleAttributes.filter((attribute) => attribute.required || attribute.fixed);
  const optionalAttributes = visibleAttributes.filter((attribute) => !attribute.required && !attribute.fixed);

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-ad-title">
        <header className="modal-card__header">
          <div>
            <span className="section-tag">Novo anuncio</span>
            <h2 id="create-ad-title">Publicar anuncio no Mercado Livre</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>
            Fechar
          </button>
        </header>

        <form className="modal-form" onSubmit={onSubmit}>
          <div className="modal-form__grid">
            <label className="field field--full">
              <span>Titulo</span>
              <div className="field__row">
                <input
                  value={form.title}
                  onChange={(event) => onFieldChange('title', event.target.value)}
                  placeholder="Ex.: Notebook Dell Inspiron 15"
                  required
                  maxLength={titleLimit}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onLoadCategorySuggestions}
                  disabled={isLoadingCategorySuggestions || form.title.trim().length < 3}
                >
                  {isLoadingCategorySuggestions ? 'Buscando...' : 'Sugerir categoria'}
                </button>
              </div>
              <small className="field__hint">
                Titulo enviado: {effectiveTitle || 'Nao definido'} ({effectiveTitle.length}/{titleLimit})
              </small>
            </label>

            {categorySuggestions.length > 0 ? (
              <div className="field field--full">
                <span>Categorias sugeridas</span>
                <div className="suggestion-list">
                  {categorySuggestions.map((suggestion) => (
                    <button
                      key={`${suggestion.category_id}-${suggestion.domain_id}`}
                      type="button"
                      className={`suggestion-chip ${
                        form.category_id === suggestion.category_id ? 'suggestion-chip--active' : ''
                      }`}
                      onClick={() => onSelectCategory(suggestion)}
                    >
                      <strong>{suggestion.category_name}</strong>
                      <span>{suggestion.category_id}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="field">
              <span>Categoria</span>
              <div className="field__row">
                <input
                  value={form.category_id}
                  onChange={(event) => onFieldChange('category_id', event.target.value.toUpperCase())}
                  placeholder="Ex.: MLB1648"
                  required
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onLoadCategoryContext}
                  disabled={isLoadingCategoryContext || !form.category_id.trim()}
                >
                  {isLoadingCategoryContext ? 'Carregando...' : 'Carregar categoria'}
                </button>
              </div>
              {selectedCategoryPath ? <small className="field__hint">{selectedCategoryPath}</small> : null}
            </label>

            <label className="field">
              <span>Tipo de anuncio</span>
              {listingTypes.length > 0 ? (
                <select
                  value={form.listing_type_id}
                  onChange={(event) => onFieldChange('listing_type_id', event.target.value)}
                  required
                >
                  <option value="">Selecione</option>
                  {listingTypes.map((listingType) => (
                    <option key={listingType.id} value={listingType.id}>
                      {listingType.name} ({listingType.id})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={form.listing_type_id}
                  onChange={(event) => onFieldChange('listing_type_id', event.target.value)}
                  placeholder="Carregue a categoria para ver os tipos validos"
                  required
                />
              )}
            </label>

            <label className="field">
              <span>Condicao</span>
              <select
                value={form.condition}
                onChange={(event) => onFieldChange('condition', event.target.value)}
              >
                <option value="new">Novo</option>
                <option value="used">Usado</option>
              </select>
            </label>

            <label className="field">
              <span>Preco</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={(event) => onFieldChange('price', event.target.value)}
                placeholder="1999.90"
                required
              />
            </label>

            <label className="field">
              <span>Estoque</span>
              <input
                type="number"
                min="1"
                step="1"
                value={form.available_quantity}
                onChange={(event) => onFieldChange('available_quantity', event.target.value)}
                placeholder="10"
                required
              />
            </label>

            <label className="field">
              <span>Moeda</span>
              <input
                value={form.currency_id}
                onChange={(event) => onFieldChange('currency_id', event.target.value.toUpperCase())}
                placeholder="BRL"
              />
            </label>

            <label className="field">
              <span>Buying mode</span>
              <input
                value={form.buying_mode}
                onChange={(event) => onFieldChange('buying_mode', event.target.value)}
                placeholder="buy_it_now"
              />
            </label>
          </div>

          {requiredAttributes.length > 0 ? (
            <section className="attribute-panel">
              <header className="attribute-panel__header">
                <div>
                  <span className="section-tag">Atributos obrigatorios</span>
                  <p>Preencha os campos que a categoria exige para validar e publicar.</p>
                </div>
              </header>
              <div className="attribute-grid">
                {requiredAttributes.map((attribute) => (
                  <label key={attribute.id} className="field">
                    <span>
                      {attribute.name}
                      {attribute.fixed ? ' (fixo)' : ''}
                    </span>
                    {renderAttributeInput(attribute, attributeDrafts[attribute.id], onAttributeChange)}
                    {attribute.tooltip ? <small className="field__hint">{attribute.tooltip}</small> : null}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          {optionalAttributes.length > 0 ? (
            <section className="attribute-panel">
              <header className="attribute-panel__header">
                <div>
                  <span className="section-tag">Atributos opcionais</span>
                  <p>O validador pode sugerir alguns desses campos para melhorar a qualidade da publicacao.</p>
                </div>
              </header>
              <div className="attribute-grid">
                {optionalAttributes.map((attribute) => (
                  <label key={attribute.id} className="field">
                    <span>{attribute.name}</span>
                    {renderAttributeInput(attribute, attributeDrafts[attribute.id], onAttributeChange)}
                  </label>
                ))}
              </div>
            </section>
          ) : null}

          <label className="field field--stacked">
            <span>Imagens</span>
            <textarea
              rows={4}
              value={form.pictures}
              onChange={(event) => onFieldChange('pictures', event.target.value)}
              placeholder="Cole uma URL por linha. O backend envia cada linha como picture.source."
            />
          </label>

          {validationIssues.length > 0 ? (
            <section className="validation-panel">
              <header className="validation-panel__header">
                <span className="section-tag">Validacao do payload</span>
                <p>Revise os pontos abaixo antes de tentar publicar.</p>
              </header>
              <ul className="validation-list">
                {validationIssues.map((issue, index) => (
                  <li key={`${issue.code || issue.cause_id || 'issue'}-${index}`} className="validation-item">
                    <strong>{issue.code || issue.type || 'validation_issue'}</strong>
                    <p>{issue.message || 'O Mercado Livre retornou uma validacao sem mensagem detalhada.'}</p>
                    {issue.references && issue.references.length > 0 ? (
                      <span>{issue.references.join(', ')}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <footer className="modal-card__footer">
            <p className="modal-card__hint">
              O fluxo sugere categoria pelo titulo, carrega os tipos validos da conta conectada nesta
              sessao e valida o payload antes de publicar.
            </p>
            <div className="modal-card__actions">
              <button type="button" className="ghost-button" onClick={onValidate} disabled={isValidating}>
                {isValidating ? 'Validando...' : 'Validar anuncio'}
              </button>
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Publicando...' : 'Publicar anuncio'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default AdCreateModal;
