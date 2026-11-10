// ============ 設定檔（只需要改這裡）============
window.RATING_CONFIG = {
  title: "公司內部成果發表會・匿名評分",
  subtitle: "11/10 上午 9:30｜每人發表 5 分鐘｜透過小人提學習成果與未來應用方向",

  // 發表人名單：請改成實際同事姓名（順序＝發表順序）
  presenters: ["靜枝", "莉晴", "Maggie", "羿瑄"],

  minScore: 0,           // 最低分
  maxScore: 10,          // 最高分（每位發表人可給 minScore ~ maxScore 分）
  prize: 1000,           // 第一名紅包金額（平分則均分）
  allowSelfVote: false,  // false：選擇「我是誰」後，不能投給自己

  // 結果頁密碼：留空＝任何人都能看即時結果；填數字＝需輸入密碼
  adminPin: "",

  // 選票上傳位置（ntfy.sh 公開訊息主題；主題名稱相當於密鑰，請勿外流）
  topic: "gongshi-fabiaohui-20261110-k7q2x9m",
  server: "https://ntfy.sh"
};
