export const SITE_TITLE = '공부 기록';
export const SITE_DESCRIPTION = 'GPU 커널과 AI 논문을 공부하며 남기는 기록. 직접 쓴 설명과 직접 만든 위젯.';

export const TYPE_LABEL = { session: '세션', concept: '개념', essay: '에세이' } as const;
export const STATUS_LABEL = { todo: '예정', doing: '진행 중', done: '완료' } as const;

// 딥러닝 학습 과정 지도 단계 (stage 0~8)
export const STAGES = [
	{ n: 0, name: '데이터 준비', desc: '문장을 토큰으로 자르고 배치로 묶음' },
	{ n: 1, name: '모델 정의·초기화', desc: '층 구조를 정하고 가중치 W를 난수로 채움' },
	{ n: 2, name: '순전파', desc: '입력이 층을 지나며 활성화값을 만듦' },
	{ n: 3, name: '손실 계산', desc: '예측과 정답 차이를 토큰마다 숫자로 만듦' },
	{ n: 4, name: '신용 할당', desc: '각 가중치의 책임(기울기)을 구함' },
	{ n: 5, name: '가중치 갱신', desc: '기울기 반대로 W를 옮김' },
	{ n: 6, name: '반복', desc: '2~5단계를 배치마다 되풀이' },
	{ n: 7, name: '평가', desc: '학습에 안 쓴 데이터로 성능 측정' },
	{ n: 8, name: '추론', desc: '학습된 모델로 새 입력 처리' },
] as const;
