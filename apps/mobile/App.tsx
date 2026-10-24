import { useState } from 'react';
import LedgerApp from './LedgerApp';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { tokens } from '../../packages/design-tokens/src';
import { formatMoney, galleryFixtures } from '../../packages/domain/src';
import {
  AccountRow, Badge, Button, Field, Heading, Money, Notice, Panel, PostingRow,
  TransactionRow, nativeStyles as textStyles, type Tone,
} from '../../packages/ui-native/src';

type Screen = 'accounts' | 'transactions' | 'entry' | 'prices' | 'sync' | 'components';
type PreviewState = 'normal' | 'loading' | 'empty' | 'error' | 'saving' | 'offline' | 'success';
const screens: readonly [Screen, string][] = [
  ['accounts', '계정'], ['transactions', '거래'], ['entry', '입력'], ['prices', '시세'], ['sync', '동기화'], ['components', '기본 요소'],
];
const states: readonly [PreviewState, string][] = [
  ['normal', '정상'], ['loading', '로딩'], ['empty', '빈 결과'], ['error', '오류'],
  ['saving', '저장 중'], ['offline', '오프라인'], ['success', '성공'],
];
const titles: Record<Screen, [string, string]> = {
  accounts: ['내 계정', '계정의 잔액을 통화별로 확인합니다.'],
  transactions: ['거래 기록', '원장에 담긴 하루의 흐름을 살펴보세요.'],
  entry: ['새 거래', '두 분개로 완성하는 단순한 기록.'],
  prices: ['시세', '기준일과 출처를 함께 확인합니다.'],
  sync: ['연결과 동기화', '연결 상태와 마지막 반영 시각을 구분합니다.'],
  components: ['기본 요소', '같은 디자인 언어, 모바일에 맞는 조작.'],
};

function Gallery() {
  const [screen, setScreen] = useState<Screen>('accounts');
  const [state, setState] = useState<PreviewState>('normal');
  const [worst, setWorst] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedTransaction, setSelectedTransaction] = useState<string | null>(null);
  const [onlyCleared, setOnlyCleared] = useState(false);
  const [commodityFilter, setCommodityFilter] = useState('전체');
  const [description, setDescription] = useState('점심 식사');
  const [date, setDate] = useState('2026-10-19');
  const [amount, setAmount] = useState('12500');
  const [commodity, setCommodity] = useState('KRW');
  const [expenseAccount, setExpenseAccount] = useState('expenses:food');
  const [assetAccount, setAssetAccount] = useState('assets:bank:checking');
  const [memo, setMemo] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [componentAmount, setComponentAmount] = useState('숫자가 아님');
  const { fontScale } = useWindowDimensions();
  const fixtures = worst ? galleryFixtures.worstCase : galleryFixtures;
  const lowerQuery = query.trim().toLocaleLowerCase();
  const accounts = fixtures.accounts.filter(account => `${account.name} ${account.path}`.toLocaleLowerCase().includes(lowerQuery));
  const transactions = fixtures.transactions.filter(transaction =>
    `${transaction.description} ${transaction.postings.map(posting => posting.accountName).join(' ')}`.toLocaleLowerCase().includes(lowerQuery)
    && (!onlyCleared || transaction.status === 'cleared'));
  const prices = fixtures.prices.filter(price => commodityFilter === '전체' || price.commodity === commodityFilter);
  const account = fixtures.accounts.find(item => item.id === selectedAccount);
  const featuredAccount = account ?? fixtures.accounts[0];
  const transaction = fixtures.transactions.find(item => item.id === selectedTransaction);
  const validAmount = /^-?[0-9]+(?:\.[0-9]+)?$/.test(amount);
  const validCommodity = commodity.trim().length > 0 && commodity.length <= 32;
  const nonzeroAmount = validAmount && /[1-9]/.test(amount);
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  const validDate = parsedDate !== null && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date;
  const amountError = !validAmount ? '숫자와 소수점으로 입력해 주세요. 예: 12500.00' : !nonzeroAmount ? '0이 아닌 금액을 입력해 주세요.' : undefined;
  const dateError = validDate ? undefined : '실제 달력 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.';
  const descriptionError = description.trim().length > 0 && description.length <= 512 ? undefined : '내용을 1~512자로 입력해 주세요.';
  const accountError = expenseAccount.trim() && assetAccount.trim() && expenseAccount.trim() !== assetAccount.trim() ? undefined : '서로 다른 두 계정을 입력해 주세요.';
  const oppositeAmount = amount.startsWith('-') ? amount.slice(1) : `-${amount}`;
  const contentHidden = state === 'loading' || state === 'empty' || state === 'error';

  function navigate(next: Screen) {
    setScreen(next); setQuery(''); setSelectedAccount(null); setSelectedTransaction(null);
  }

  function useSample() {
    const sample = fixtures.transactions[0];
    if (!sample) return;
    setDescription(sample.description); setDate(sample.date);
    setAmount(sample.postings[0]?.amount.value ?? '12500');
    setCommodity(sample.postings[0]?.amount.commodity ?? 'KRW');
    setExpenseAccount(sample.postings[0]?.accountName ?? 'expenses:food');
    setAssetAccount(sample.postings[1]?.accountName ?? 'assets:bank:checking');
    setMemo(sample.postings[0]?.memo ?? ''); setAttempted(false); setState('normal');
  }

  function previewSave() {
    setAttempted(true);
    if (!amountError && !dateError && !descriptionError && !accountError && validCommodity && memo.length <= 1000) setState('saving');
  }

  const stateNotice = state === 'normal' ? null : state === 'loading'
    ? <Notice title="로딩 화면 · 데모" action={{ label: '로딩 미리보기 끝내기', onPress: () => setState('normal') }}>가상 자료를 불러오는 표현입니다. 실제 요청은 진행하지 않습니다.</Notice>
    : state === 'empty' ? <Notice title="아직 표시할 자료가 없어요" action={{ label: '가상 자료 다시 보기', onPress: () => setState('normal') }}>빈 화면을 검토 중입니다. 입력한 검색 조건과 관계없이 비어 있는 상태를 표시합니다.</Notice>
    : state === 'error' ? <Notice tone="danger" title="자료를 가져오지 못했어요 · 데모" action={{ label: '미리보기 재시도', onPress: () => setState('normal') }}>연결 오류 예시입니다. 재시도하면 정상 가상 자료로 돌아갑니다.</Notice>
    : state === 'saving' ? <Notice tone="accent" title="저장 중 화면 · 데모" action={{ label: '가상 저장 완료 화면 보기', onPress: () => setState('success') }}>실제 저장은 진행하지 않습니다. 완료 버튼으로 다음 상태를 검토하세요.</Notice>
    : state === 'offline' ? <Notice tone="warning" title="오프라인 임시 저장 화면 · 데모" action={{ label: '온라인 화면으로 돌아가기', onPress: () => setState('normal') }}>입력은 현재 화면 메모리에만 남습니다. 앱을 닫으면 사라지며 저장 큐나 재전송은 구현 전입니다.</Notice>
    : <Notice tone="success" title="성공 화면 · 데모" action={{ label: '정상 상태로 돌아가기', onPress: () => setState('normal') }}>성공 메시지의 디자인 예시입니다. 원장 저장이나 실제 동기화는 수행되지 않았습니다.</Notice>;

  return <SafeAreaView style={styles.safe} edges={['right', 'bottom', 'left']}>
    <StatusBar barStyle="dark-content" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View accessible={false} style={styles.monogram}><Text style={styles.monogramText}>h</Text></View>
            <Text style={[styles.brand, styles.flex]}>hledger</Text>
            <Badge>가상 원장 · 데모</Badge>
          </View>
        </View>

        <View style={styles.navigation}>
          {screens.map(([key, label]) => <Pressable key={key} accessibilityRole="button"
            accessibilityLabel={`${label} 화면 보기`} accessibilityState={{ selected: screen === key }}
            onPress={() => navigate(key)} style={({ pressed }) => [styles.navigationItem,
              fontScale > 1.4 && styles.largeNavigationItem, screen === key && styles.navigationSelected,
              pressed && styles.navigationPressed]}>
            <Text style={[styles.navigationText, screen === key && styles.navigationSelectedText]}>{label}</Text>
          </Pressable>)}
        </View>
        <View style={styles.reviewTools}>
          <Pressable accessibilityRole="button" accessibilityLabel="상태 미리보기"
            accessibilityState={{ expanded: reviewExpanded }} onPress={() => setReviewExpanded(value => !value)}
            style={({ pressed }) => [styles.reviewSummary, pressed && styles.navigationPressed]}>
            <Text style={[textStyles.caption, styles.switchCopy]}>{states.find(([key]) => key === state)?.[1]} · {worst ? '긴 데이터' : '기본 데이터'}</Text>
            <Text style={styles.reviewToggle}>검토 옵션 {reviewExpanded ? '−' : '+'}</Text>
          </Pressable>
          {reviewExpanded ? <View style={styles.reviewOptions}>
            <View style={styles.chips}>
              {states.map(([key, label]) => <Button key={key} selected={state === key} onPress={() => setState(key)} label={`${label} 상태 미리보기`}>{label}</Button>)}
            </View>
            <View style={styles.switchRow}>
              <View style={styles.switchCopy}><Text style={textStyles.strong}>긴 데이터로 검토</Text><Text style={textStyles.caption}>긴 계정명 · 큰 금액 · 작은 소수</Text></View>
              <Switch accessibilityLabel="긴 데이터로 검토" accessibilityRole="switch" hitSlop={12} value={worst}
                onValueChange={value => { setWorst(value); setSelectedAccount(null); setSelectedTransaction(null); setCommodityFilter('전체'); }}
                trackColor={{ false: tokens.colors.borderStrong, true: tokens.colors.accent }} thumbColor={tokens.colors.surface} />
            </View>
          </View> : null}
        </View>

        <View style={styles.sectionTop}>
          <Heading>{titles[screen][0]}</Heading>
          {screen === 'accounts' ? <Text style={textStyles.caption}>{fixtures.accounts.length}개 계정</Text> : null}
        </View>
        {stateNotice}

        {!contentHidden && screen === 'accounts' ? <>
          {featuredAccount ? <View style={styles.featureCard}>
            <View style={styles.sectionTop}>
              <Text style={styles.featureCaption}>{account ? '선택한 계정 잔액' : '계정 잔액'}</Text>
              <Text style={styles.featureCaption}>2026.10.19 기준</Text>
            </View>
            <Text style={styles.featureName}>{featuredAccount.name || featuredAccount.path}</Text>
            <View style={styles.featureBalances}>
              {featuredAccount.balances.map((balance, i) => <Text key={`${balance.commodity}-${i}`} selectable
                accessibilityLabel={formatMoney(balance.value, balance.commodity)} style={styles.featureAmount}>
                {formatMoney(balance.value, balance.commodity)}
              </Text>)}
            </View>
            <Text selectable style={styles.featureCaption}>{featuredAccount.path}</Text>
          </View> : null}
          <Panel style={styles.accountPanel}>
            <View style={styles.accountSearch}>
              <Field label="계정 검색" placeholder="이름이나 경로로 찾기" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
              <View style={styles.sectionTop}><Text style={textStyles.strong}>전체 계정</Text><Text style={textStyles.caption}>{accounts.length}개</Text></View>
            </View>
            <View style={styles.accountList}>
              {accounts.map(item => <AccountRow key={item.id} account={item} selected={selectedAccount === item.id} onPress={() => setSelectedAccount(selectedAccount === item.id ? null : item.id)} />)}
              {accounts.length === 0 ? <Text style={textStyles.muted}>일치하는 계정이 없어요. 다른 검색어를 입력해 주세요.</Text> : null}
            </View>
          </Panel>
          {account ? <Panel><Heading subtitle={account.path}>계정 상세</Heading>
            {account.balances.map((balance, i) => <Money key={i} {...balance} prominent />)}
            <Text style={textStyles.caption}>계정 자체 잔액 예시 · 하위 계정 합산 없음</Text>
            <Button onPress={() => { navigate('transactions'); setQuery(account.path); }}>이 계정의 거래 살펴보기</Button>
          </Panel> : null}
        </> : null}

        {!contentHidden && screen === 'transactions' ? <>
          <Panel>
            <Field label="거래 검색" placeholder="내용 또는 계정 경로" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
            <View style={styles.switchRow}><Text style={[textStyles.body, styles.switchCopy]}>확인된 거래만 보기</Text><Switch
              accessibilityLabel="확인된 거래만 보기" hitSlop={12} value={onlyCleared} onValueChange={setOnlyCleared}
              trackColor={{ false: tokens.colors.borderStrong, true: tokens.colors.accent }} thumbColor={tokens.colors.surface} /></View>
            <Text style={textStyles.caption}>{transactions.length}개 거래 · 거래를 눌러 분개 확인</Text>
            {transactions.map(item => <TransactionRow key={item.id} transaction={item} selected={selectedTransaction === item.id}
              onPress={() => setSelectedTransaction(selectedTransaction === item.id ? null : item.id)} />)}
            {transactions.length === 0 ? <Text style={textStyles.muted}>검색 결과가 없어요. 검색어와 확인 상태를 바꿔 보세요.</Text> : null}
          </Panel>
          {transaction ? <Panel><Heading subtitle={transaction.date}>{transaction.description}</Heading>
            <Text style={textStyles.caption}>거래 코드: {transaction.code ?? '없음'} · 출처: {transaction.source}</Text>
            {transaction.postings.map((posting, i) => <PostingRow key={i} posting={posting} />)}
            <View style={styles.wrapped}>{transaction.tags.map(tag => <Badge key={tag.key}>{tag.key}: {tag.value}</Badge>)}</View>
            <Text style={textStyles.caption}>생성 시각: 원장에 기록 없음</Text>
            <Button onPress={() => { navigate('entry'); setDescription(transaction.description); setDate(transaction.date); setAmount(transaction.postings[0]?.amount.value ?? '12500'); setCommodity(transaction.postings[0]?.amount.commodity ?? 'KRW'); setExpenseAccount(transaction.postings[0]?.accountName ?? 'expenses:food'); setAssetAccount(transaction.postings[1]?.accountName ?? 'assets:bank:checking'); setState('normal'); }}>이 거래로 입력 예시 채우기</Button>
          </Panel> : <Notice title="거래 한 건을 눌러 보세요">선택한 거래의 분개와 통화, 태그가 이곳에 표시됩니다.</Notice>}
        </> : null}

        {!contentHidden && screen === 'entry' ? <Panel>
          <View style={styles.sectionTop}><Text style={styles.eyebrow}>거래 입력 예시</Text><Badge tone="accent">단일 통화</Badge></View>
          <Button onPress={useSample}>현재 가상 자료로 채우기</Button>
          <Field label="날짜" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" autoCorrect={false} error={attempted ? dateError : undefined} />
          <Field label="거래 내용" value={description} onChangeText={setDescription} multiline error={attempted ? descriptionError : undefined} />
          <Text style={textStyles.strong}>분개 1 · 지출 또는 입금</Text>
          <Field label="첫 번째 계정" value={expenseAccount} onChangeText={setExpenseAccount} autoCapitalize="none" autoCorrect={false} error={attempted ? accountError : undefined} />
          <Field label="금액" value={amount} onChangeText={setAmount} keyboardType="numbers-and-punctuation" autoCorrect={false} autoCapitalize="none"
            hint="문자열 decimal을 유지합니다. 예: 0.00000001" error={attempted ? amountError : undefined} />
          <Field label="통화 / commodity" value={commodity} onChangeText={setCommodity} autoCapitalize="characters" autoCorrect={false}
            error={attempted && !validCommodity ? '통화를 1~32자로 입력해 주세요.' : undefined} />
          <Text style={textStyles.strong}>분개 2 · 상대 계정</Text>
          <Field label="두 번째 계정" value={assetAccount} onChangeText={setAssetAccount} autoCapitalize="none" autoCorrect={false} error={attempted ? accountError : undefined} />
          {validAmount && validCommodity ? <View style={styles.balancePreview}><Text style={textStyles.caption}>같은 통화로 반대 금액 · 합계 0</Text><Money value={oppositeAmount} commodity={commodity} /></View> : null}
          <Field label="메모 (선택)" value={memo} onChangeText={setMemo} multiline error={attempted && memo.length > 1000 ? '메모는 1000자 이내로 입력해 주세요.' : undefined} />
          <Notice title="입력 디자인만 검토합니다">저장 버튼은 저장 중·성공 화면만 전환합니다. 실제 거래 생성이나 기기 저장은 없습니다.</Notice>
          <Button variant="primary" disabled={state === 'saving'} onPress={previewSave}>가상 저장 흐름 보기</Button>
        </Panel> : null}

        {!contentHidden && screen === 'prices' ? <Panel>
          <View style={styles.sectionTop}><Text style={styles.eyebrow}>시세 자료</Text><Badge>가상 인용값</Badge></View>
          <View style={styles.chips}>
            {['전체', ...new Set(fixtures.prices.map(price => price.commodity))].map(item => <Button key={item} selected={commodityFilter === item} onPress={() => setCommodityFilter(item)}>{item}</Button>)}
          </View>
          {prices.map((price, i) => <View key={`${price.commodity}-${i}`} style={styles.priceRow}>
            <Text style={textStyles.strong}>{price.commodity} → {price.quoteCommodity}</Text>
            <Money value={price.rate} commodity={price.quoteCommodity} prominent />
            <Text style={textStyles.caption}>1 {price.commodity} 기준 · {price.date}</Text>
            <Text style={textStyles.caption}>출처: {price.source ?? '기록 없음'}</Text>
          </View>)}
          <Notice title="환산 합계는 제공하지 않습니다">표시된 시세는 디자인 검토용 가상 자료입니다. 금액과 시세의 소수 자릿수는 원본 그대로 표시합니다.</Notice>
        </Panel> : null}

        {!contentHidden && screen === 'sync' ? <Panel>
          <View style={styles.sectionTop}><Text style={styles.eyebrow}>가상 연결 상태</Text><Badge tone={state === 'offline' ? 'warning' : state === 'success' ? 'success' : 'neutral'}>{state === 'offline' ? '오프라인 예시' : state === 'success' ? '성공 예시' : '연결 전'}</Badge></View>
          <View style={styles.fact}><Text style={textStyles.muted}>실제 API 연결</Text><Text style={textStyles.strong}>구현 전</Text></View>
          <View style={styles.fact}><Text style={textStyles.muted}>마지막 성공 동기화</Text><Text style={textStyles.strong}>성공 이력 없음</Text></View>
          <View style={styles.fact}><Text style={textStyles.muted}>인덱서 지연</Text><Text style={textStyles.strong}>측정되지 않음</Text></View>
          <View style={styles.fact}><Text style={textStyles.muted}>영구 저장 큐</Text><Text style={textStyles.strong}>구현 전</Text></View>
          <Text style={textStyles.muted}>실제 서버나 원장에 접근하지 않습니다. 성공 화면을 선택해도 마지막 동기화 시각을 만들어내지 않습니다.</Text>
          <Button variant="primary" onPress={() => setState('loading')}>연결 중 화면 보기</Button>
          <Button onPress={() => setState('offline')}>오프라인 화면 보기</Button>
          <Button onPress={() => setState('success')}>동기화 성공 메시지 보기</Button>
        </Panel> : null}

        {!contentHidden && screen === 'components' ? <>
          <Panel><Heading subtitle="공통 토큰을 실제 네이티브 요소에 적용합니다.">조작과 피드백</Heading>
            <Button variant="primary" onPress={() => setSampleCount(count => count + 1)}>버튼 눌러 보기 · {sampleCount}회</Button>
            <View style={styles.wrapped}>
              <Button onPress={() => setSampleCount(0)}>횟수 초기화</Button>
              <Button selected onPress={() => setSampleCount(count => count + 1)}>선택된 보조 버튼</Button>
              <Button variant="quiet" onPress={() => setSampleCount(count => count + 1)}>조용한 버튼</Button>
              <Button variant="primary" disabled onPress={() => {}}>사용할 수 없음</Button>
            </View>
            <Text style={textStyles.caption}>주요 행동은 진한 강조, 선택 상태는 약한 배경으로 구분합니다.</Text>
            <View style={styles.wrapped}>{(['neutral', 'accent', 'success', 'warning', 'danger'] as Tone[]).map((tone, i) => <Badge key={tone} tone={tone}>{['기본', '강조', '성공', '주의', '오류'][i]}</Badge>)}</View>
            <Field label="입력 예시" value={query} onChangeText={setQuery} placeholder="이곳에 입력해 보세요" hint="레이블은 입력 중에도 표시됩니다." />
            <Field label="읽기 전용 입력 예시" value="assets:bank:checking" editable={false} hint="불러온 계정 경로입니다. 이 예시에서는 수정할 수 없습니다." />
            <Field label="오류 입력 예시" value={componentAmount} onChangeText={setComponentAmount} autoCorrect={false}
              hint="숫자로 바꾸면 오류가 사라집니다. 예: 12500.00"
              error={!/^-?[0-9]+(?:\.[0-9]+)?$/.test(componentAmount) ? '숫자와 소수점으로 입력해 주세요. 예: 12500.00' : undefined} />
            <Money value={worst ? '999999999999999999999999999.00000001' : '1234567.00'} commodity="KRW" prominent />
          </Panel>
          <Panel><Heading subtitle="약한 배경과 상태 문구를 함께 제공합니다.">상태별 안내</Heading>
            <Notice title="안내 · 기본">목록에서 계정을 선택하면 상세 정보를 확인할 수 있어요.</Notice>
            <Notice tone="accent" title="진행 중 · 데모">가상 저장 흐름을 검토하고 있어요.</Notice>
            <Notice tone="success" title="완료 · 데모">완료 메시지의 예시입니다. 실제 저장은 진행하지 않았어요.</Notice>
            <Notice tone="warning" title="주의 · 데모">오프라인 예시입니다. 현재 입력은 화면 메모리에만 남아요.</Notice>
            <Notice tone="danger" title="오류 · 데모">가져오지 못한 자료가 있어요. 정상 상태로 바꾸어 다시 확인해 주세요.</Notice>
          </Panel>
          <Panel><Heading subtitle="색상만으로 상태를 전달하지 않습니다.">색상과 간격</Heading>
            {Object.entries(tokens.colors).map(([name, color]) => <View key={name} style={styles.tokenRow}>
              <View accessible={false} style={[styles.swatch, { backgroundColor: color }]} /><View style={styles.flex}><Text style={textStyles.strong}>{name}</Text><Text selectable style={textStyles.caption}>{color}</Text></View>
            </View>)}
            <Text style={textStyles.muted}>간격 {Object.values(tokens.space).join(' · ')} / 최소 터치 영역 {tokens.size.controlMin}pt</Text>
            <Text style={textStyles.caption}>시스템 서체 · 본문 {tokens.typography.body.fontSize}pt · 시스템 글자 확대 지원</Text>
          </Panel>
          <Panel><Heading subtitle="공식 원칙을 참고해 이 갤러리에 맞게 적용했습니다.">디자인 참고 자료</Heading>
            <Text style={textStyles.caption}>목록의 정보 위계 · 선택과 행동의 강조 · 상태별 색상 역할 · 글자 확대</Text>
            {[
              ['Toss TDS · ListRow', 'https://tossmini-docs.toss.im/tds-mobile/components/ListRow/list-row-overview/'],
              ['Adobe Spectrum · Attention hierarchy', 'https://spectrum.adobe.com/foundations/composition/attention-hierarchy'],
              ['당근 SEED · Color role', 'https://seed-design.io/foundations/color/color-role'],
              ['Apple HIG · Accessibility', 'https://developer.apple.com/design/human-interface-guidelines/accessibility'],
            ].map(([label, url]) => <Pressable key={url} accessibilityRole="link" accessibilityLabel={`${label} 공식 문서 열기`}
              onPress={() => { void Linking.openURL(url); }} style={({ pressed }) => [styles.referenceLink, pressed && { backgroundColor: tokens.colors.surfacePressed }]}>
              <Text style={styles.referenceLinkText}>{label} ↗</Text>
            </Pressable>)}
          </Panel>
        </> : null}

        <View style={styles.footer}><Text style={textStyles.caption}>DESIGN REVIEW · 가상 데이터만 사용</Text><Text style={textStyles.caption}>GraphQL 연결과 실제 저장은 디자인 리뷰 후 구현합니다.</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export default function App() {
  const [gallery, setGallery] = useState(false);
  return <SafeAreaProvider><View style={styles.flex}>
    <View style={[styles.flex, gallery && { display: 'none' }]}><LedgerApp onOpenGallery={() => setGallery(true)} /></View>
    {gallery && <>
      <SafeAreaView edges={['top']} style={styles.modeBar}>
        <Text style={textStyles.caption}>디자인 갤러리 · 가상 자료</Text>
        <Button variant="quiet" onPress={() => setGallery(false)}>실제 원장으로</Button>
      </SafeAreaView>
      <Gallery />
    </>}
  </View></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modeBar: { backgroundColor: tokens.colors.background, paddingHorizontal: tokens.space.lg, paddingVertical: tokens.space.xs, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: tokens.space.sm },
  safe: { flex: 1, backgroundColor: tokens.colors.background },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: tokens.space.lg, paddingBottom: tokens.space.xxl, gap: tokens.space.lg },
  header: { paddingTop: tokens.space.xs, paddingBottom: tokens.space.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md },
  monogram: { width: 36, height: 36, backgroundColor: tokens.colors.featureBackground, borderRadius: tokens.radius.control, justifyContent: 'center', alignItems: 'center' },
  monogramText: { color: tokens.colors.featureText, fontSize: 27, lineHeight: 32, fontWeight: '600' },
  brand: { color: tokens.colors.text, fontSize: 20, fontWeight: '600' },
  navigation: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: tokens.colors.surfaceSubtle,
    padding: tokens.space.xs, borderRadius: tokens.radius.panel, gap: tokens.space.xs },
  navigationItem: { flexGrow: 1, flexBasis: '30%', minHeight: tokens.size.controlMin, minWidth: 0,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: tokens.space.sm, paddingVertical: tokens.space.sm,
    borderRadius: tokens.radius.control },
  largeNavigationItem: { flexBasis: '45%' },
  navigationSelected: { backgroundColor: tokens.colors.surface },
  navigationPressed: { backgroundColor: tokens.colors.surfacePressed },
  navigationText: { ...tokens.typography.label, color: tokens.colors.muted, textAlign: 'center' },
  navigationSelectedText: { color: tokens.colors.accent },
  reviewTools: { marginTop: -tokens.space.sm, gap: tokens.space.sm },
  reviewSummary: { minHeight: tokens.size.controlMin, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', gap: tokens.space.sm, borderRadius: tokens.radius.control },
  reviewToggle: { color: tokens.colors.muted, ...tokens.typography.label, flexShrink: 1 },
  reviewOptions: { gap: tokens.space.md, paddingTop: tokens.space.sm },
  eyebrow: { color: tokens.colors.muted, ...tokens.typography.label },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm, alignItems: 'flex-start' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md, minHeight: tokens.size.controlMin },
  switchCopy: { flex: 1, minWidth: 0, gap: tokens.space.xs },
  sectionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: tokens.space.sm, flexWrap: 'wrap' },
  wrapped: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space.sm },
  featureCard: { backgroundColor: tokens.colors.featureBackground, borderRadius: tokens.radius.feature,
    padding: tokens.space.xl, gap: tokens.space.md },
  featureCaption: { ...tokens.typography.supporting, color: tokens.colors.featureMuted, minWidth: 0, flexShrink: 1 },
  featureName: { ...tokens.typography.label, color: tokens.colors.featureText },
  featureBalances: { gap: tokens.space.sm, minWidth: 0 },
  featureAmount: { ...tokens.typography.hero, color: tokens.colors.featureText, fontVariant: ['tabular-nums'],
    minWidth: 0, maxWidth: '100%', flexShrink: 1, letterSpacing: -0.5 },
  accountPanel: { gap: 0 },
  accountSearch: { gap: tokens.space.lg, paddingBottom: tokens.space.xs },
  accountList: { minWidth: 0 },
  balancePreview: { padding: tokens.space.md, borderRadius: tokens.radius.control, backgroundColor: tokens.colors.background, gap: tokens.space.sm },
  priceRow: { borderTopWidth: 1, borderColor: tokens.colors.border, paddingTop: tokens.space.lg, gap: tokens.space.sm },
  fact: { paddingBottom: tokens.space.md, borderBottomWidth: 1, borderColor: tokens.colors.border, gap: tokens.space.xs },
  tokenRow: { flexDirection: 'row', alignItems: 'center', gap: tokens.space.md },
  swatch: { width: 44, height: 44, borderWidth: 1, borderColor: tokens.colors.border, borderRadius: tokens.radius.control },
  referenceLink: { minHeight: tokens.size.controlMin, justifyContent: 'center', paddingVertical: tokens.space.sm, borderRadius: tokens.radius.control },
  referenceLinkText: { color: tokens.colors.accent, ...tokens.typography.supporting, textDecorationLine: 'underline' },
  footer: { gap: tokens.space.xs, paddingTop: tokens.space.sm },
});
