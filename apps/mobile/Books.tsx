import { useLingui } from '../../packages/i18n/src/react';
import { translateError } from '../../packages/i18n/src';
import type { MessageDescriptor } from '@lingui/core';
import { useEffect, useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { normalizeBookCoverUrl } from '../../packages/domain/src/book-cover-url';
import {
  Badge,
  Button,
  Field,
  Heading,
  Money,
  Notice,
  Panel,
  nativeStyles as styles,
} from '../../packages/ui-native/src';
import type { BookController } from './book-module';

export function Books({ controller, verified }: { controller: BookController; verified: boolean }) {
  const { _ } = useLingui();
  function displayNotice(value: unknown): string {
    if (value instanceof Error && 'descriptor' in value)
      return _(value.descriptor as MessageDescriptor);
    if (value && typeof value === 'object' && 'retryCause' in value)
      return _(
        /* i18n */ {
          id: 'books.retryPreserved',
          message: '{detail}\n입력을 보관했습니다. 같은 요청 키로만 재시도합니다.',
          values: { detail: displayNotice(value.retryCause) },
        },
      );
    if (typeof value === 'string') return translateError(value);
    if (value && typeof value === 'object' && 'id' in value) return _(value as MessageDescriptor);
    return translateError(value);
  }
  const {
    draftMismatch,
    identity,
    busy,
    message,
    books,
    loadedIdentity,
    date,
    setDate,
    isbn,
    title,
    setTitle,
    authors,
    setAuthors,
    metadata,
    metadataMessage,
    price,
    setPrice,
    currency,
    setCurrency,
    assetAccount,
    setAssetAccount,
    cashAccount,
    setCashAccount,
    selected,
    setSelected,
    kind,
    setKind,
    proceeds,
    setProceeds,
    fee,
    setFee,
    gainAccount,
    setGainAccount,
    lossAccount,
    setLossAccount,
    feeAccount,
    setFeeAccount,
    locked,
    changeIsbn,
    titleEdited,
    authorsEdited,
    refresh,
    submit,
    lookupMetadata,
  } = controller;
  return (
    <View style={{ gap: 16 }}>
      {draftMismatch && (
        <Notice
          tone="warning"
          title={_(
            /* i18n */ {
              id: 'native.books.draft.originalLedger',
              message: '입력의 원래 원장으로 연결해 주세요.',
            },
          )}
        >
          {_(
            /* i18n */ {
              id: 'native.books.draft.preserved',
              message: '다른 원장에 입력을 전송하지 않도록 잠갔습니다. 입력은 그대로 보관합니다.',
            },
          )}
        </Notice>
      )}
      {!verified && (
        <Notice
          title={_(/* i18n */ { id: 'native.books.17', message: '연결이 필요해요' })}
          tone="warning"
        >
          {_(
            /* i18n */ {
              id: 'native.books.18',
              message:
                '책 구매·판매·폐기는 원장 연결 후 저장할 수 있습니다. 오프라인에서는 전송을 기다립니다.',
            },
          )}
        </Notice>
      )}
      {Boolean(message) && (
        <Notice title={_(/* i18n */ { id: 'native.books.19', message: '책 기록 안내' })}>
          {displayNotice(message)}
        </Notice>
      )}
      <Panel>
        <Heading
          subtitle={_(
            /* i18n */ { id: 'native.books.24', message: '동일한 ISBN도 실물 한 권씩 구분합니다.' },
          )}
        >
          {_(/* i18n */ { id: 'native.books.25', message: '내 책' })}
        </Heading>
        <Button disabled={busy || !verified} onPress={() => void refresh()}>
          {_(/* i18n */ { id: 'native.books.26', message: '목록 새로고침' })}
        </Button>
        {loadedIdentity === identity &&
          books.map((book) => (
            <View key={book.id} style={{ gap: 8 }}>
              <BookCover uri={book.coverUrl} title={book.title} />
              <Text style={styles.strong}>{book.title}</Text>
              {book.authors.length > 0 && (
                <Text style={styles.muted}>{book.authors.join(', ')}</Text>
              )}
              <Text selectable style={styles.caption}>
                {book.isbn} · {book.id}
              </Text>
              <Badge>
                {book.status === 'HELD'
                  ? _(/* i18n */ { id: 'native.books.27', message: '보유 중' })
                  : book.status === 'SOLD'
                    ? _(/* i18n */ { id: 'native.books.28', message: '판매 완료' })
                    : _(/* i18n */ { id: 'native.books.29', message: '폐기 완료' })}
              </Badge>
              <Text style={styles.caption}>
                {_(/* i18n */ { id: 'native.books.30', message: '장부 가치' })}
              </Text>
              <Money
                value={book.status === 'HELD' ? book.purchasePrice.value : '0'}
                commodity={book.purchasePrice.commodity}
              />
              <Text style={styles.caption}>
                {_(/* i18n */ { id: 'native.books.31', message: '취득 원가' })}{' '}
                {book.purchasePrice.value} {book.purchasePrice.commodity}
              </Text>
              {book.realizedGain && (
                <>
                  <Text style={styles.caption}>
                    {_(/* i18n */ { id: 'native.books.32', message: '실현 손익 (수수료 반영)' })}
                  </Text>
                  <Money value={book.realizedGain.value} commodity={book.realizedGain.commodity} />
                </>
              )}
              <Button
                disabled={locked || book.status !== 'HELD'}
                onPress={() => {
                  setSelected(book.id);
                  setCurrency(book.purchasePrice.commodity);
                }}
              >
                {_(/* i18n */ { id: 'native.books.33', message: '이 책 판매·폐기' })}
              </Button>
            </View>
          ))}
        {loadedIdentity === identity && books.length === 0 && (
          <Text style={styles.muted}>
            {_(/* i18n */ { id: 'native.books.34', message: '등록한 책이 없습니다.' })}
          </Text>
        )}
      </Panel>
      <Panel>
        <Heading>
          {selected
            ? _(/* i18n */ { id: 'native.books.35', message: '선택한 책 판매·폐기' })
            : _(/* i18n */ { id: 'native.books.36', message: '책 한 권 구매' })}
        </Heading>
        {selected && (
          <>
            <Text selectable style={styles.caption}>
              {_(/* i18n */ { id: 'native.books.37', message: '실물 식별자' })} {selected}
            </Text>
            <Button disabled={locked} selected={kind === 'SELL'} onPress={() => setKind('SELL')}>
              {_(/* i18n */ { id: 'native.books.38', message: '판매' })}
            </Button>
            <Button
              disabled={locked}
              selected={kind === 'DISCARD'}
              onPress={() => setKind('DISCARD')}
            >
              {_(/* i18n */ { id: 'native.books.39', message: '폐기' })}
            </Button>
          </>
        )}
        <Field
          label={_(/* i18n */ { id: 'native.books.40', message: '거래일' })}
          value={date}
          onChangeText={setDate}
          editable={!locked}
          placeholder="YYYY-MM-DD"
        />
        {!selected && (
          <>
            <Field label="ISBN" value={isbn} onChangeText={changeIsbn} editable={!locked} />
            <Field
              label={_(/* i18n */ { id: 'native.books.41', message: '책 제목' })}
              maxLength={200}
              value={title}
              onChangeText={(value) => {
                titleEdited.current = true;
                setTitle(value);
              }}
              editable={!locked}
            />
            <Field
              label={_(
                /* i18n */ { id: 'native.books.42', message: '저자 (선택 · 한 줄에 한 명)' },
              )}
              value={authors}
              multiline
              onChangeText={(value) => {
                authorsEdited.current = true;
                setAuthors(value);
              }}
              editable={!locked}
            />
            {metadataMessage ? (
              <Text style={styles.muted}>{displayNotice(metadataMessage)}</Text>
            ) : null}
            {metadata && (
              <>
                <BookCover
                  uri={metadata.coverUrl}
                  title={title}
                  source={metadata.coverSource}
                  sourceUrl={metadata.coverSourceUrl}
                />
                <Text style={styles.caption}>{metadata.attribution}</Text>
                <Text selectable style={styles.caption}>
                  {metadata.sourceUrl}
                </Text>
              </>
            )}
            <Button disabled={locked || !verified} onPress={() => void lookupMetadata()}>
              {_(/* i18n */ { id: 'native.books.43', message: 'ISBN 정보 다시 조회' })}
            </Button>
            <Field
              label={_(/* i18n */ { id: 'native.books.44', message: '구매 금액' })}
              value={price}
              onChangeText={setPrice}
              editable={!locked}
              keyboardType="decimal-pad"
            />
            <Field
              label={_(/* i18n */ { id: 'native.books.45', message: '책 항목' })}
              value={assetAccount}
              onChangeText={setAssetAccount}
              editable={!locked}
            />
          </>
        )}
        {(!selected || kind === 'SELL') && (
          <>
            <Field
              label={_(/* i18n */ { id: 'native.books.46', message: '통화' })}
              value={currency}
              onChangeText={setCurrency}
              editable={!locked && !selected}
            />
            <Field
              label={_(/* i18n */ { id: 'native.books.47', message: '현금 항목' })}
              value={cashAccount}
              onChangeText={setCashAccount}
              editable={!locked}
            />
          </>
        )}
        {selected && (
          <>
            <Field
              label={_(/* i18n */ { id: 'native.books.48', message: '손실 항목' })}
              value={lossAccount}
              onChangeText={setLossAccount}
              editable={!locked}
            />
            {kind === 'SELL' && (
              <>
                <Field
                  label={_(
                    /* i18n */ { id: 'native.books.49', message: '판매 대금 (수수료 차감 전)' },
                  )}
                  value={proceeds}
                  onChangeText={setProceeds}
                  editable={!locked}
                  keyboardType="decimal-pad"
                />
                <Field
                  label={_(/* i18n */ { id: 'native.books.50', message: '수수료' })}
                  value={fee}
                  onChangeText={setFee}
                  editable={!locked}
                  keyboardType="decimal-pad"
                />
                <Field
                  label={_(/* i18n */ { id: 'native.books.51', message: '이익 항목' })}
                  value={gainAccount}
                  onChangeText={setGainAccount}
                  editable={!locked}
                />
                <Field
                  label={_(/* i18n */ { id: 'native.books.52', message: '수수료 항목' })}
                  value={feeAccount}
                  onChangeText={setFeeAccount}
                  editable={!locked}
                />
              </>
            )}
          </>
        )}
        <Button variant="primary" disabled={locked || !verified} onPress={submit}>
          {busy
            ? _(/* i18n */ { id: 'native.books.53', message: '처리 중…' })
            : selected
              ? kind === 'SELL'
                ? _(/* i18n */ { id: 'native.books.54', message: '판매와 실현 손익 기록' })
                : _(/* i18n */ { id: 'native.books.55', message: '폐기와 손실 기록' })
              : _(/* i18n */ { id: 'native.books.56', message: '이 실물 책 구매 기록' })}
        </Button>
        {selected && (
          <Button disabled={locked} onPress={() => setSelected('')}>
            {_(/* i18n */ { id: 'native.books.57', message: '구매 입력으로 돌아가기' })}
          </Button>
        )}
      </Panel>
    </View>
  );
}

function BookCover({
  uri,
  title,
  source,
  sourceUrl,
}: {
  uri?: string | null;
  title: string;
  source?: string | null;
  sourceUrl?: string | null;
}) {
  const { _ } = useLingui();
  const [failed, setFailed] = useState(false);
  const safeUri = normalizeBookCoverUrl(uri);
  useEffect(() => {
    setFailed(false);
  }, [uri]);
  if (!safeUri || failed)
    return (
      <Text style={styles.caption}>
        {_(/* i18n */ { id: 'native.books.58', message: '표지 없음' })}
      </Text>
    );
  const imageUrl = new URL(safeUri);
  const aladin = imageUrl.hostname === 'image.aladin.co.kr';
  const openLibrary = imageUrl.hostname === 'covers.openlibrary.org';
  const yes24Id =
    imageUrl.hostname === 'image.yes24.com'
      ? /^\/goods\/(\d+)\/xl$/.exec(imageUrl.pathname)?.[1]
      : undefined;
  const fallbackLink = aladin
    ? 'https://www.aladin.co.kr/'
    : yes24Id
      ? `https://www.yes24.com/Product/Goods/${yes24Id}`
      : openLibrary
        ? /^\/b\/isbn\/(\d{13})-L\.jpg$/.test(imageUrl.pathname)
          ? `https://openlibrary.org/isbn/${imageUrl.pathname.split('/')[3]?.slice(0, 13)}`
          : 'https://openlibrary.org/'
        : 'https://www.nl.go.kr/';
  let link = fallbackLink;
  try {
    const url = new URL(sourceUrl || fallbackLink);
    const safeConnection = url.protocol === 'https:' && !url.username && !url.password && !url.port;
    const matchingYes24Product =
      url.hostname === 'www.yes24.com' &&
      url.pathname === `/Product/Goods/${yes24Id}` &&
      !url.search &&
      !url.hash;
    const matchingAladinProduct =
      url.hostname === 'www.aladin.co.kr' &&
      url.pathname === '/shop/wproduct.aspx' &&
      /^\?ItemId=\d+$/.test(url.search) &&
      !url.hash;
    if (
      safeConnection &&
      (aladin
        ? matchingAladinProduct
        : yes24Id
          ? matchingYes24Product
          : [
              'openlibrary.org',
              'www.openlibrary.org',
              'nl.go.kr',
              'www.nl.go.kr',
              'seoji.nl.go.kr',
            ].includes(url.hostname))
    )
      link = url.href;
  } catch {
    /* Keep the known provider URL. */
  }
  return (
    <View style={{ gap: 4 }}>
      <Image
        source={{ uri: safeUri }}
        accessibilityLabel={_(
          /* i18n */ {
            id: 'books.coverAlt',
            message: '{title} 표지',
            values: { title: title || _(/* i18n */ { id: 'native.books.59', message: '책' }) },
          },
        )}
        style={{ width: 80, height: 112 }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
      <Text
        accessibilityRole="link"
        style={styles.caption}
        onPress={() => {
          void Linking.openURL(link).catch(() => undefined);
        }}
      >
        {_(/* i18n */ { id: 'native.books.60', message: '표지 제공:' })}{' '}
        {aladin
          ? 'Aladin'
          : yes24Id
            ? 'YES24'
            : source === 'OPEN_LIBRARY' || openLibrary
              ? 'Open Library'
              : _(/* i18n */ { id: 'native.books.61', message: '국립중앙도서관' })}
      </Text>
    </View>
  );
}
