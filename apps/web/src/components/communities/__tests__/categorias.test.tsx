import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelList, CommunityRail, type Channel } from '../CommunityParts';
import { CommunitySettingsDialog } from '../CommunityDialogs';
import {
  applyLayout, buildSections, dropOnChannel, dropOnSection, moveCategory, moveChannel, setChannelCategory,
} from '../channelLayout';
import { api, type CommunityDetail } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const categories = [
  { id: 'k2', name: 'Jogos', position: 1 },
  { id: 'k1', name: 'Geral', position: 0 },
];
const channels: Channel[] = [
  { id: 't1', name: 'boas-vindas', kind: 'TEXT', position: 0, categoryId: null },
  { id: 'v1', name: 'Sala', kind: 'VOICE', position: 1, categoryId: null },
  { id: 'a', name: 'avisos', kind: 'TEXT', position: 2, categoryId: 'k1' },
  { id: 'b', name: 'bate-papo', kind: 'TEXT', position: 3, categoryId: 'k1' },
  { id: 'c', name: 'partidas', kind: 'TEXT', position: 4, categoryId: 'k2' },
];
const ids = (layout: ReturnType<typeof moveChannel>) => layout?.channels.map((c) => `${c.id}:${c.categoryId ?? '-'}`);

describe('channelLayout', () => {
  const sections = buildSections(channels, categories);

  it('agrupa sem categoria por tipo e depois categorias pela posicao', () => {
    expect(sections.map((s) => s.key)).toEqual(['kind:TEXT', 'kind:VOICE', 'category:k1', 'category:k2']);
    expect(sections[2]!.channels.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('Alt+Seta troca dentro da secao e para na borda', () => {
    expect(ids(moveChannel(sections, 'b', -1))).toEqual(['t1:-', 'v1:-', 'b:k1', 'a:k1', 'c:k2']);
    expect(moveChannel(sections, 'a', -1)).toBeNull();
    expect(moveChannel(sections, 'c', 1)).toBeNull();
  });

  it('arrastar sobre outro canal assume a categoria dele', () => {
    expect(ids(dropOnChannel(sections, 'c', 'a'))).toEqual(['t1:-', 'v1:-', 'c:k1', 'a:k1', 'b:k1']);
    expect(ids(dropOnChannel(sections, 'a', 'b'))).toEqual(['t1:-', 'v1:-', 'b:k1', 'a:k1', 'c:k2']);
    expect(ids(dropOnChannel(sections, 'a', 't1'))).toEqual(['a:-', 't1:-', 'v1:-', 'b:k1', 'c:k2']);
    // Canal de texto solto sobre canal de voz sem categoria vai para o grupo de texto.
    expect(ids(dropOnChannel(sections, 'a', 'v1'))).toEqual(['t1:-', 'a:-', 'v1:-', 'b:k1', 'c:k2']);
  });

  it('soltar no titulo e escolher categoria levam para o fim', () => {
    expect(ids(dropOnSection(sections, 't1', 'category:k2'))).toEqual(['v1:-', 'a:k1', 'b:k1', 'c:k2', 't1:k2']);
    expect(ids(setChannelCategory(sections, 'c', null))).toEqual(['t1:-', 'c:-', 'v1:-', 'a:k1', 'b:k1']);
    expect(setChannelCategory(sections, 'a', 'k1')).toBeNull();
  });

  it('move categoria e aplica o layout localmente', () => {
    const layout = moveCategory(sections, 'k2', -1)!;
    expect(layout.categories).toEqual(['k2', 'k1']);
    const applied = applyLayout(channels, categories, layout);
    expect(applied.categories.map((c) => c.id)).toEqual(['k2', 'k1']);
    expect(applied.channels.map((c) => c.id)).toEqual(['t1', 'v1', 'c', 'a', 'b']);
  });
});

describe('ChannelList com categorias', () => {
  afterEach(() => window.localStorage.clear());
  const base = { name: 'Grupo', voiceStates: [], onSelect: vi.fn(), onInvite: vi.fn(), onSettings: vi.fn(), canManage: true };

  it('recolhe categoria e lembra no navegador', () => {
    render(<ChannelList {...base} channels={channels} categories={categories} />);
    const header = screen.getByRole('button', { name: 'Jogos' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /partidas/ })).toBeInTheDocument();
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /partidas/ })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('scale:collapsed-categories') ?? '[]')).toEqual(['k2']);
  });

  it('localStorage indisponivel nao quebra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    render(<ChannelList {...base} channels={channels} categories={categories} />);
    fireEvent.click(screen.getByRole('button', { name: 'Jogos' }));
    expect(screen.getByRole('button', { name: 'Jogos' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('Alt+Seta e arrastar chamam onLayout; sem permissao nada muda', () => {
    const onLayout = vi.fn();
    const { rerender } = render(<ChannelList {...base} channels={channels} categories={categories} onLayout={onLayout} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /bate-papo/ }), { key: 'ArrowUp', altKey: true });
    expect(onLayout).toHaveBeenLastCalledWith(expect.objectContaining({ channels: expect.arrayContaining([{ id: 'b', categoryId: 'k1' }]) }));
    expect(onLayout.mock.lastCall?.[0].channels.map((c: { id: string }) => c.id)).toEqual(['t1', 'v1', 'b', 'a', 'c']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Jogos' }), { key: 'ArrowUp', altKey: true });
    expect(onLayout.mock.lastCall?.[0].categories).toEqual(['k2', 'k1']);

    const items = screen.getAllByTestId('channel-item');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(items[4]!, { dataTransfer });
    fireEvent.dragOver(items[2]!, { dataTransfer });
    fireEvent.drop(items[2]!, { dataTransfer });
    expect(onLayout.mock.lastCall?.[0].channels).toEqual([
      { id: 't1', categoryId: null }, { id: 'v1', categoryId: null }, { id: 'c', categoryId: 'k1' }, { id: 'a', categoryId: 'k1' }, { id: 'b', categoryId: 'k1' },
    ]);

    onLayout.mockClear();
    rerender(<ChannelList {...base} channels={channels} categories={categories} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /bate-papo/ }), { key: 'ArrowUp', altKey: true });
    expect(onLayout).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('channel-item')[0]).not.toHaveAttribute('draggable', 'true');
  });

  it('sem categorias mantem os grupos de texto e voz', () => {
    render(<ChannelList {...base} channels={channels.map((c) => ({ ...c, categoryId: null }))} />);
    expect(screen.getByText('Canais de texto')).toBeInTheDocument();
    expect(screen.getByText('Canais de voz')).toBeInTheDocument();
  });

  it('mostra o banner quando ha', () => {
    const { rerender } = render(<ChannelList {...base} channels={channels} />);
    expect(screen.queryByTestId('community-banner')).toBeNull();
    rerender(<ChannelList {...base} channels={channels} bannerUrl="/api/communities/c1/banner?v=1" />);
    expect(screen.getByTestId('community-banner')).toHaveAttribute('src', '/api/communities/c1/banner?v=1');
  });
});

describe('CommunityRail com icone', () => {
  it('usa a imagem quando ha icone e as iniciais quando nao ha', () => {
    render(
      <CommunityRail
        communities={[
          { id: 'a', name: 'Alfa', role: 'MEMBER', iconUpdatedAt: '2026-01-01T00:00:00.000Z' },
          { id: 'b', name: 'Beta', role: 'MEMBER', iconUpdatedAt: null },
        ]}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
        onJoin={vi.fn()}
      />,
    );
    const alfa = screen.getByRole('button', { name: 'Alfa' });
    expect(alfa.querySelector('img')).toHaveAttribute('src', '/api/communities/a/icon?v=2026-01-01T00%3A00%3A00.000Z');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveTextContent('BE');
  });
});

describe('Configuracoes: aparencia e categorias', () => {
  const none = { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false };
  function detail(overrides: Partial<CommunityDetail>): CommunityDetail {
    return {
      community: { id: 'c1', name: 'Grupo', ownerId: 'dono', iconUpdatedAt: null, bannerUpdatedAt: null },
      myRole: 'MEMBER', myPermissions: none, roles: [], categories: [{ id: 'k1', name: 'Geral', position: 0 }],
      channels: [{ id: 'ch1', name: 'geral', kind: 'TEXT', position: 0, categoryId: null }],
      members: [], ...overrides,
    };
  }
  const open = (d: CommunityDetail, onChanged = vi.fn()) =>
    render(<CommunitySettingsDialog detail={d} meId="eu" onClose={vi.fn()} onChanged={onChanged} onGone={vi.fn()} />);

  it('ADMIN ve aparencia e envia o icone', async () => {
    const upload = vi.spyOn(api, 'uploadCommunityImage').mockResolvedValue();
    const onChanged = vi.fn();
    open(detail({ myRole: 'ADMIN', myPermissions: { ...none, manageChannels: true } }), onChanged);
    expect(screen.getByRole('heading', { name: 'Aparência' })).toBeInTheDocument();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'i.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('community-icon-input'), { target: { files: [file] } });
    await waitFor(() => expect(upload).toHaveBeenCalledWith('c1', 'icon', file));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('cargo com manageChannels gerencia categorias mas nao a aparencia', async () => {
    const create = vi.spyOn(api, 'createCategory').mockResolvedValue();
    const save = vi.spyOn(api, 'saveCommunityLayout').mockResolvedValue();
    open(detail({ myPermissions: { ...none, manageChannels: true } }));
    expect(screen.queryByRole('heading', { name: 'Aparência' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Nome da nova categoria'), { target: { value: 'Jogos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar categoria' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c1', 'Jogos'));
    fireEvent.change(screen.getByLabelText('Categoria do canal geral'), { target: { value: 'k1' } });
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', { categories: ['k1'], channels: [{ id: 'ch1', categoryId: 'k1' }] }));
  });

  it('membro comum nao ve categorias nem aparencia', () => {
    open(detail({}));
    expect(screen.queryByRole('heading', { name: 'Categorias' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Aparência' })).toBeNull();
  });
});
