---
title: "DUST 세션 1: 역전파 없이 기울기를 얻는 방법"
type: session
date: 2026-10-31
minutes: 0
topics: ["[[DUST]]", "[[0차 최적화]]", "[[역전파]]", "[[노드 섭동]]", "[[Forward gradient]]"]
stage: [2, 3, 4, 5]
status: done
publish: true
source: claude-chat
original: "https://qlabs.sh/research/dust/"
---

> DUST는 가중치 갱신 규칙(경사하강법)은 그대로 둡니다. 기울기를 얻는 방법만 바꿉니다. 역전파는 연쇄 법칙으로 기울기를 계산하고, DUST는 활성화값을 무작위로 흔든 뒤 손실 변화로 기울기를 추정합니다.

## 0. 학습 과정에서의 위치

이 세션의 개념은 학습 2~5단계(순전파 → 손실 → 신용 할당 → 갱신)에 있습니다. DUST는 4단계(신용 할당)를 바꾸고, 그 재료인 섭동을 2단계에서 넣습니다. 전체 지도: [[딥러닝 학습 과정 지도]]

## 1. 처음 이해한 것과 정정

- 내 이해: 역전파는 기울기를 계산하는 수학적 도구일 뿐, 가중치 수정의 유일한 원리가 아니다.
- 정정 1: 역전파(기울기 계산)와 경사하강법(갱신 규칙 $W \leftarrow W - \eta G$)은 층위가 다르다. DUST도 갱신은 SGD+모멘텀·Adam으로 한다. $G$의 출처만 다르다.
- 정정 2: "나쁜 방향을 배제한다"는 부정확하다. 나쁜 방향은 음의 가중치로 뒤집어 반영한다.

## 2. 기존 방법과의 차이

| 방법 | 흔드는 대상 | 기울기 출처 | 순전파 1회당 평가 후보 |
| --- | --- | --- | --- |
| 역전파 | 없음 | 연쇄 법칙(정확값) | — |
| 가중치 공간 ES (Salimans 2017, EGGROLL 2025) | 가중치 | 후보별 손실 차이 | 시퀀스당 1개 |
| MeZO (2023, 미세조정) | 가중치 | 손실 차이 | 방향 1개에 순전파 2회 |
| Forward gradient (Ren 2023) | 활성화 | 순방향 자동미분 + 지역 손실 | — |
| 노드 섭동 (Widrow·Lehr 1990) | 활성화 | 손실 차이 | — |
| DUST | 각 선형층 출력(토큰별 독립) | 토큰별 손실 차이 | 토큰 수만큼 |

핵심 차이: 후보 단위가 "가중치 사본 1개"에서 "토큰 1개"로 바뀌었다.

## 3. 기여 (원문 주장)

1. 트랜스포머 LM 사전학습에서 역전파와 경쟁하는 첫 0차 방법이라고 주장. 10만·100만 토큰에서는 큰 개체군에서 역전파보다 낮은 테스트 손실.
2. 2천만 토큰: 외삽 극한 4.431 (95% 구간 3.89~4.58) vs 역전파 4.633. 외삽값이지 측정값이 아님.
3. 가중치 공간 ES보다 10³~10⁴배 효율적(외삽). EGGROLL 16k도 DUST 64 draw에 못 미침.
4. 큰 모델이 개체군 효율이 더 좋음(2M~243M 비교). 통념과 반대.
5. K가 커질수록 역전파 기울기와의 코사인 상승, 1B 토큰 체크포인트까지 유지.
6. 한계: 계산 효율은 목표 아님. 실험 규모 작음(기본 8층·폭 512, 학습 최대 2천만 토큰).

## 4. 섭동 (perturbation)

- 직관: 일부러 살짝 흔들고 결과가 좋아졌는지 본다.
- 형식: 선형층 출력에 잡음을 더한다.

$$
y_t \rightarrow y_t + \sigma a_t,\quad a_t \sim \mathcal{N}(0, I)
$$

- 왜 활성화를 흔드는가: 출력 $\sigma a$ 변화 = 가중치 rank-1 변화 $\Delta W = \sigma a x^\top / \lVert x \rVert^2$. $(W+\Delta W)x = y + \sigma a$. 가중치 사본 없이 "가중치를 바꾼 후보"를 흉내 낸다 → 가상 개체군(virtual population).

## 5. 순전파 한 번에 여러 후보를 평가하는 방법

1. 토큰 축: 토큰마다 독립 잡음 + 토큰마다 손실 → 토큰 1개 = 후보 1개.
2. Draw 축: 모든 토큰을 한 번 흔든 것 = draw 1개. K개 draw를 한 배치로 같이 순전파. K = 개체군.
3. 비용 절감: clean 순전파 캐시(블록 l부터만 재계산), 층 종류별 별도 순전파(간섭 감소), LM head는 캐시된 로짓에 직접 잡음.
4. 주의: K=16k면 갱신 1회에 부분 순전파 약 16k회. 계산량이 크다.

## 6. 오차 반응으로 방향을 정하는 기준

1. 손실 측정: draw $i$ 적용 → 토큰 $s$별 손실 $\ell_s^{(i)}$.
2. 기준선 빼기: $c_s = \tilde{\ell}_s - \ell_s$ ($\tilde{\ell}_s$ = 같은 토큰의 $K$개 draw 평균). $c_s > 0$ = 좋은 방향.
3. 보상 합산 (어텐션으로 뒤 토큰에도 영향):

$$
r_t = \sum_{s \ge t} \gamma^{s-t} c_s
$$

4. 보상 가중 평균 = 출력 오차 추정:

$$
\hat{g}_t = -\frac{1}{K\sigma}\sum_{i=1}^{K} r_t^{(i)} a_t^{(i)}
$$

5. 가중치 기울기 = 역전파와 같은 외적:

$$
\hat{G}_W = \sum_t \hat{g}_t x_t^{\top}
$$

6. 갱신: SGD+모멘텀 또는 Adam.

<iframe src="/widgets/dust-perturbation-estimate.html" width="100%" height="620" loading="lazy" style="border:0"></iframe>

- $\gamma$: 대부분 층 0, key·value·gate·value embedding만 ≈1.
- 어텐션 내부(q·k·v): $c_s = -\langle \hat{g}_s, \Delta o_s \rangle$ 로 어텐션 출력 오차와의 정렬로 점수.

### 왜 올바른 방향이 나오는가

1. $\sigma$가 작으면 손실 변화 ≈ $\sigma (g \cdot a)$.
2. $\hat{g} \approx \frac{1}{K}\sum (g\cdot a - \text{평균})\, a$.
3. $E[(g\cdot a)a] = E[aa^\top]g = Ig = g$.
4. 신호는 $K$에 비례, 잡음은 $\sqrt{K}$ → $K$가 클수록 $\hat{g} \to g$.

장난감 시뮬레이션 (d=128, 200회 평균, 원문 실험 아님):

| K | 실측 코사인 | 이론 1/√(1+d/K) |
| --- | --- | --- |
| 16 | 0.325 | 0.333 |
| 64 | 0.574 | 0.577 |
| 256 | 0.818 | 0.816 |
| 1024 | 0.943 | 0.943 |
| 4096 | 0.985 | 0.985 |

원문 식 (5) $\cos(K) = c_{\max}/\sqrt{1+c/K}$ 와 같은 형태.

## 7. 역전파가 활성화값을 VRAM에 두는 이유

1. 층 $l$의 가중치 기울기 → 층 입력 $x_l$ 필요:

$$
\frac{\partial L}{\partial W_l} = \delta_l \, x_l^{\top}
$$

2. 출력 오차 $\delta_l$ → 위층 오차와 사전 활성화 $z_l$ 필요:

$$
\delta_l = \left(W_{l+1}^{\top}\,\delta_{l+1}\right) \odot f'(z_l)
$$

3. 순전파 $1 \to L$, 역전파 $L \to 1$. $x_1$은 가장 먼저 저장되고 가장 늦게 쓰인다.
4. 메모리 ∝ 층 수 × 배치 × 시퀀스 × 폭. 완화: 활성화 체크포인팅.
5. 주의: DUST 원문은 메모리 절감을 주장하지 않는다. clean 순전파를 캐시한다. "역전파 없음 = 메모리 절약"은 MeZO 계열 주장.

<iframe src="/widgets/backprop-activation-memory.html" width="100%" height="460" loading="lazy" style="border:0"></iframe>

## 8. 시험용 압축 포인트

- 역전파 = 기울기 계산법, 경사하강법 = 갱신 규칙. DUST는 앞의 것만 바꾼다.
- 섭동 대상은 가중치가 아니라 선형층 출력(활성화), 토큰마다 독립.
- 후보 점수 = 같은 토큰의 draw 평균 대비 손실 감소량.
- 나쁜 방향도 버리지 않고 뒤집어서 반영한다.
- 최종 기울기는 역전파와 같은 외적 $\hat{g}x^\top$.
- 정확도는 $K$에 따라 $\cos \approx 1/\sqrt{1+c/K}$로 오른다.
- 역전파가 활성화를 보관하는 이유: 기울기 계산이 순전파 뒤 역순으로 늦게 일어나기 때문.

## 9. 질문·헷갈린 점

### Q1. 갱신은 경사하강법인데 g의 출처가 다르다는 게 무슨 뜻인가?

- 경사하강법은 $g$를 만들지 않는다. 이미 구한 $g$를 받아 $W \leftarrow W - \eta g$로 옮길 뿐이다.
- 학습 한 스텝: ① 순전파로 $L$ → ② $g$ 구하기(역전파 또는 DUST) → ③ 갱신(경사하강법).
- 비유: 경사하강법 = 내리막으로 한 걸음 걷는 규칙, 역전파 = 지형 공식을 미분해 경사 측정, DUST = 발을 디뎌 보고 경사 추정.
- 검산: $L(w)=(w-3)^2$, $w=5$, $\eta=0.1$. 미분 $g=2(5-3)=4$. 흔들기($h=0.1$): $(L(5.1)-L(4.9))/0.2 = (4.41-3.61)/0.2 = 4.0$. 갱신은 둘 다 $w=5-0.4=4.6$.
- PyTorch 대응: `loss.backward()` = $g$ 계산, `optimizer.step()` = 경사하강법. DUST는 개념상 `backward()` 자리만 교체.

<iframe src="/widgets/gradient-source-vs-update.html" width="100%" height="560" loading="lazy" style="border:0"></iframe>

### Q2. DUST는 딥러닝에서 어떤 개념에 해당하나?

- 정정: 경사하강법이 조정하는 대상은 기울기가 아니라 가중치 $W$다. 기울기는 매 스텝 새로 구하는 정보다.
- 답: 학습 파이프라인(모델 · 손실 · 신용 할당 · 옵티마이저 · 데이터) 중 신용 할당(credit assignment) 칸. 역전파와 같은 칸, 다른 방법.
- 분류: 0차 최적화(zeroth-order) 계열의 섭동 기반 기울기 추정기. 손실 값(0차 정보)만 보고 기울기(1차 정보)를 추정해 1차 옵티마이저(SGD·Adam)에 넘긴다.
- 계보: 노드 섭동(활성화 섭동) → DUST. 가중치 섭동 계열은 ES·EGGROLL·MeZO.
- 해석: $\hat{g} = -(1/K\sigma)\sum r\cdot a$ 는 "시도 × 보상" 평균 → 강화학습 REINFORCE와 같은 구조(원문 주장 아님).

<iframe src="/widgets/dust-position-in-pipeline.html" width="100%" height="460" loading="lazy" style="border:0"></iframe>

### Q3. Forward gradient는 무엇인가?

- 무작위 방향 $v$를 뽑고, 방향 미분 $\nabla L\cdot v$를 순방향 자동미분(forward mode)으로 정확히 계산한 뒤 $\hat{g} = (\nabla L\cdot v)\,v$ 로 추정. $E[(\nabla L\cdot v)v] = \nabla L$ (불편 추정).
- 핵심 장치: 이중수(dual number). 각 연산이 (값, 접선) 쌍을 들고 순전파와 동시에 진행 → 활성화 보관 거의 불필요.
- 역방향 모드(역전파)는 한 번에 $\nabla L$ 전체, 순방향 모드는 한 번에 방향 1개 성분.
- 검산: $L=(w_1w_2-1)^2$, $w=(2,1)$, $\nabla L=(2,4)$. $v=(0.6,0.8)$ → $u$ 접선 2.2, $e$ 접선 2.2, $L$ 접선 4.4 = 2×0.6+4×0.8. $\hat{g}=(2.64, 3.52)$.
- 같은 방향을 흔들어 재면(전진 차분): σ=0.1 → 5.001, σ=0.01 → 4.458. 정확값 4.4.
- DUST와 공통점: 추정식 모양이 같고, 차원이 크면 방향 수 K가 많이 필요(d=128: K=16 cos 0.33, K=256 cos 0.82, K=4096 cos 0.99).
- 차이: forward gradient는 미분 가능 구조 필요(1차), σ 불필요. DUST는 미분 불필요(0차), 대신 σ·간섭 조정 필요.

<iframe src="/widgets/forward-mode-dual-numbers.html" width="100%" height="520" loading="lazy" style="border:0"></iframe>

### Q4. 섭동에서 "일부러 흔든다"는 무슨 뜻인가? 노드 섭동은 어떻게 착안했나?

- 값에 작은 무작위 잡음을 일부러 더하고($y \to y + \sigma a$) 손실 변화를 측정하는 것. 예: $y=[0.8, -1.2, 0.5]$, $a=[0.3, -1.1, 0.4]$, $\sigma=0.1$ → $[0.83, -1.31, 0.54]$.
- 용어: 섭동(攝動, perturbation)은 천문학에서 행성 궤도의 작은 교란을 뜻하던 말.
- 다른 잡음과 차이: 데이터 증강·드롭아웃·초기화 난수는 잡음 자체가 효과. 섭동의 잡음은 기울기를 재는 측정 도구.
- 착안 ① 아날로그 하드웨어: 역전파는 시그모이드와 그 도함수를 정확히 구현해야 하는데 아날로그 회로는 어렵다. David Andes의 MRIII는 뉴런 가중합에 작은 섭동을 더해 오차 변화로 기울기를 근사. 섭동이 작으면 역전파와 수학적으로 같다(Widrow·Lehr 1990). 이후 Flower·Jabri(1992)가 가중합 뉴런 섭동으로 정리.
- 착안 ② 차원: 완전연결층 가중치 약 N개, 노드 약 √N개 → 노드를 흔들면 대상이 줄고 분산도 준다.
- 착안 ③ 뇌 과학: 뇌는 역전파가 어렵고 뉴런 활동에 잡음이 많다 → 잡음을 섭동으로 쓰는 학습 가설. Fiete·Seung(2006), Werfel·Xie·Seung(2003, DUST가 인용).

## 10. 다음에 볼 것

- 원문 부록 E(개체군 배분), F(튜닝)
- 코드: [github.com/qlabs-eng/dust](https://github.com/qlabs-eng/dust)
- 비교 논문: MeZO(2023), EGGROLL(2025)

## 참고

- [Dust: Pretraining Transformers Without Backpropagation (Q Labs)](https://qlabs.sh/research/dust/)
- [Widrow & Lehr (1990), 30 Years of Adaptive Neural Networks](https://isl.stanford.edu/people/widrow/papers/j199030years.pdf)
- [Scaling of hardware-compatible perturbative training algorithms (2025)](https://arxiv.org/html/2501.15403v1)
- [Fiete & Seung (2006)](https://arxiv.org/abs/q-bio/0601028)
