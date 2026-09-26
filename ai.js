'use strict';
/* ============================================================
 * PicFlow 轻量 AI 图像分类（完全离线）
 * 模型：MobileNetV2（int8 量化，约 4.3 MB）+ ImageNet 1000 类标签
 * 推理：onnxruntime-node（CPU），输入取自缩略图（440px JPEG）
 * 输出：面向二次元图库的八大类别 ——
 *   角色图 / 风景图 / 插画·CG / 动物·萌宠 / 物品·道具 / 美食 / 截图 / 其他
 *
 * v1.1.0 改进（针对二次元图库误判修复）：
 *  1. 新增「截图」类别：把屏幕/UI/印刷品词（web site/screen/monitor/menu/
 *     page/newspaper/comic book/jigsaw puzzle 等）从「插画·CG」剥离，
 *     抽卡结果截图、英语学习截图、游戏 UI 截图不再被误塞进插画·CG。
 *  2. 美食只保留成品菜肴 + 明确饮品甜品，去掉蔬菜水果原材料词
 *     （broccoli/orange/apple/corn/cabbage 等容易被风景/静物误触发）。
 *  3. 角色图优先级提到风景图前：角色立绘背景的海滩/山谷词不该压过
 *     人物主体服饰词。
 *  4. 兜底不再赌「角色图」：无关键词命中一律归「其他」，宁可少分不要错分。
 *  5. MobileNetV2 是真实照片模型，对二次元/截图语义理解弱，
 *     分类不准时请在详情面板手动纠正（AI 不会覆盖手动改过的分类）。
 * ============================================================ */
const path = require('path');
const fs = require('fs');

const CATEGORIES = ['角色图', '风景图', '插画·CG', '动物·萌宠', '物品·道具', '美食', '截图', '其他'];

let ort = null;        // onnxruntime-node 模块
let session = null;    // InferenceSession
let labels = null;     // ImageNet 标签数组

/* ---------- 类别关键词映射（对 ImageNet 同义词组做词边界匹配） ----------
 * 设计原则（v1.1.0，面向二次元图库）：
 *  - 截图最优先：屏幕/UI/印刷品词很明确，不会和其它类混淆，抽卡/学习截图能正确归位。
 *  - 角色图在风景图前：二次元立绘的背景风景词不该压过人物服饰词。
 *  - 美食只收成品菜肴：蔬菜水果原材料词移除，避免风景/静物误触发。
 *  - 插画·CG 收紧到纯艺术词：comic book/书本封面/拼图等移到「截图」。
 *  - 物品·道具最后：只保留武器/乐器/车辆/家具/运动器材/厨具。
 */
const KW = {
  '截图': [
    // 屏幕 / 网页 / UI
    'web site', 'website', 'web', 'page', 'screen', 'CRT screen', 'monitor',
    'computer keyboard', 'notebook', 'binder', 'menu', 'menu card', 'envelope',
    // 印刷品 / 文字载体
    'newspaper', 'magazine', 'comic book', 'handbill', 'billboard', 'pamphlet',
    'book jacket', 'dust jacket', 'jigsaw puzzle', 'crossword puzzle',
    // 带数字/文字显示的器物
    'digital clock', 'analog clock', 'wall clock', 'stopwatch', 'typewriter', 'printer'
  ],
  '动物·萌宠': [
    'fish', 'shark', 'ray', 'whale', 'dolphin', 'porpoise', 'eel', 'salmon', 'trout', 'carp',
    'goldfish', 'tench', 'barracouta', 'sturgeon', 'gar', 'lionfish', 'puffer', 'anemone',
    'octopus', 'squid', 'cuttlefish', 'nautilus', 'starfish', 'sea urchin', 'sea cucumber',
    'jellyfish', 'conch', 'snail', 'slug', 'chiton', 'crab', 'lobster', 'crayfish', 'hermit crab',
    'shrimp', 'krill', 'barnacle', 'bird', 'eagle', 'hawk', 'falcon', 'owl', 'parrot', 'macaw',
    'cockatoo', 'lorikeet', 'coucal', 'bee eater', 'hornbill', 'hummingbird', 'hen', 'cock',
    'rooster', 'chicken', 'quail', 'partridge', 'grouse', 'ptarmigan', 'turkey', 'peacock',
    'duck', 'goose', 'swan', 'flamingo', 'pelican', 'stork', 'crane', 'pigeon', 'dove',
    'ostrich', 'penguin', 'albatross', 'grebe', 'black stork', 'wood rabbit', 'hare', 'rabbit',
    'hamster', 'porcupine', 'fox', 'squirrel', 'marmot', 'beaver', 'guinea pig', ' mouse',
    'rat', 'weasel', 'mink', 'polecat', 'otter', 'skunk', 'badger', 'armadillo',
    'sloth', 'orangutan', 'gorilla', 'chimpanzee', 'gibbon', 'siamang', 'guenon', 'patas',
    'baboon', 'macaque', 'langur', 'colobus', 'proboscis monkey', 'marmoset', 'capuchin',
    'howler monkey', 'titi', 'spider monkey', 'squirrel monkey', 'Madagascar cat', 'indri',
    'elephant', 'tusk', 'rhinoceros', 'hippopotamus', 'horse', 'pony', 'zebra', 'donkey',
    'mule', 'hinny', 'deer', 'moose', 'elk', 'caribou', 'gazelle', 'antelope', 'ox', 'water buffalo',
    'bison', 'ram', 'bighorn', 'ibex', 'hartebeest', 'impala', 'camel', 'llama',
    'cow', 'cattle', 'calf', 'pig', 'hog', 'piggy', 'boar', 'lamb', 'sheep', 'goat',
    'koala', 'wombat', 'kangaroo', 'wallaby', 'possum', 'opossum', 'panda', 'dog', 'puppy',
    'pup', 'cat', 'kitten', 'kitty', 'lion', 'tiger', 'leopard', 'jaguar', 'cougar', 'lynx',
    'cheetah', 'bear', 'polar bear', 'brown bear', 'ice bear', 'black bear', 'wolf', 'timber wolf',
    'white wolf', 'red wolf', 'coyote', 'dhole', 'hyena', 'African hunting dog', 'raccoon',
    'corgi', 'retriever', 'shepherd', 'terrier', 'poodle', 'spaniel', 'collie', 'mastiff',
    'dachshund', 'beagle', 'chihuahua', 'pug', 'husky', 'malamute', 'samoyed', 'chow', 'pomeranian',
    'python', 'cobra', 'mamba', 'viper', 'boa', 'sea snake', 'sidewinder', 'horned viper',
    'lizard', 'gecko', 'iguana', 'chameleon', 'komodo', 'Gila monster', 'green lizard',
    'crocodile', 'alligator', 'caiman', 'dinosaur', 'turtle', 'tortoise', 'terrapin', 'box turtle',
    'mud turtle', 'loggerhead', 'leatherback', 'green turtle', 'frog', 'toad', 'tree frog',
    'tailed frog', 'bullfrog', 'spadefoot', 'salamander', 'newt', 'axolotl', 'fire salamander',
    'insect', 'butterfly', 'monarch', 'admiral', 'ringlet', 'sulphur butterfly', 'lycaenid',
    'bee', 'wasp', 'ant', 'honeybee', 'beetle', 'ladybug', 'ladybeetle', 'ground beetle',
    'dragonfly', 'damselfly', 'lacewing', 'walking stick', 'cicada', 'mantis', 'cricket',
    'grasshopper', 'hopper', 'cockroach', 'fly', 'housefly', 'mosquito', 'gnat', 'firefly',
    'spider', 'tarantula', 'wolf spider', 'dust mite', 'tick', 'harvestman', 'scorpion',
    'centipede', 'isopod', 'trilobite', 'worm', 'sea slug', 'chiton', 'barnacle'
  ],
  '美食': [
    // 只保留成品菜肴 + 明确饮品甜品，去掉蔬菜水果原材料词（v1.1.0 收紧）
    'pizza', 'burger', 'cheeseburger', 'hotdog', 'hot dog', 'sandwich', 'honeycomb', 'omelet',
    'burrito', 'taco', 'guacamole', 'consomme', 'hot pot', 'trifle', 'ice cream', 'ice lolly',
    'icecream', 'French loaf', 'bagel', 'pretzel', 'mashed potato', 'spaghetti', 'carbonara',
    'noodle', 'ramen', 'sushi', 'sashimi', 'eggnog', 'red wine', 'espresso',
    'coffee', 'meat loaf', 'potpie', 'dough', 'chocolate sauce', 'baking',
    'bakery', 'cake', 'cupcake', 'cookie', 'cracker', 'waffle', 'pancake', 'pie', 'toast',
    'cheese', 'bacon', 'ham', 'steak', 'chicken breast', 'fries', 'salad', 'dessert',
    'sweets', 'confectionery'
  ],
  '角色图': [
    // 服饰 / 妆容 / 头饰 —— MobileNet 看人物时的高频输出
    'bikini', 'two-piece', 'maillot', 'kimono', 'jersey', 'T-shirt', 'tee shirt', 'suit',
    'suit of clothes', 'gown', 'abaya', 'uniform', 'sweatshirt', 'cardigan', 'poncho', 'fur coat',
    'fez', 'sombrero', 'bonnet', 'shower cap', 'cowboy hat', 'sunbonnet', 'wig', 'mask',
    'oxygen mask', 'gas mask', 'face powder', 'lipstick', 'rouge', 'mascara', 'nail polish',
    'hair spray', 'hair slide', 'perfume', 'toiletry', 'sunglasses', 'necklace', 'neck brace',
    'running suit', 'overskirt', 'pajama', 'miniskirt', 'sarong', 'half-slip', 'military uniform',
    'swimming trunks', 'breastplate', 'cuirass', 'apron', 'bib', 'diaper', 'wardrobe', 'crinoline',
    'tights', 'leotard', 'raincoat', 'coat', 'trench coat', 'wool', 'velvet', 'sandal',
    'running shoe', 'loafer', 'ballet skirt', 'hat', 'cap', 'helmet', 'football helmet',
    'crash helmet', 'ski mask', 'tank suit', 'teddy', 'brassiere', 'stole', 'fur',
    'bowtie', 'bolo', 'sweater', 'pullover', 'turtleneck', 'blazer', 'cape', 'cloak'
  ],
  '风景图': [
    'lakeshore', 'lakeside', 'seashore', 'seacoast', 'coast', 'seaside', 'beach',
    'sandbar', 'sand bar', 'breakwater', 'promontory', 'headland', 'foreland', 'cliff',
    'drop curtain', 'valley', 'vale', 'volcano', 'alp', 'geyser', 'coral reef', 'rainforest',
    'mountain', 'mountainside', 'hillside', 'canyon', 'gorge', 'rift valley', 'iceberg', 'glacier',
    'ski slope', 'reservoir', 'watertower', 'prairie', 'grassland', 'hayfield', 'paddy',
    'rice paddy', 'wreck', 'volcanic crater', 'crater', 'lava', 'magma', 'bonsai', 'forest',
    'jungle', 'grove', 'orchard', 'vineyard', 'meadow', 'sunflower field', 'corn field',
    'alpine', 'snowfield', 'dune', 'desert', 'oasis', 'waterfall', 'cascade', 'rapids',
    'billabong', 'lagoon', 'bay', 'estuary', 'fjord', 'sound', 'strait', 'sea',
    'castle', 'cathedral', 'church', 'monastery', 'convent', 'mosque', 'stupa', 'palace',
    'triumphal arch', 'bell cote', 'dome', 'minaret', 'pagoda', 'temple', 'shrine',
    'skyline', 'skyscraper', 'office building', 'bank', 'cinema', 'movie theater', 'theater',
    'library', 'museum', 'prison', 'jail', 'boathouse', 'barn', 'greenhouse', 'granary',
    'solar dish', 'solarium', 'patio', 'terrace', 'balcony', 'stairway', 'railing',
    'picket fence', 'worm fence', 'stone wall', 'vault', 'yurt', 'tile roof', 'thatch',
    'sundial', 'suspension bridge', 'viaduct', 'steel arch bridge', 'steel bridge', 'stone bridge',
    'trestle bridge', 'drawbridge', 'maypole', 'podium', 'pulpit', 'altar', 'throne',
    'streetlight', 'street sign', 'traffic light', 'pier', 'lighthouse', 'beacon', 'windmill',
    'dam', 'fountain', 'park bench', 'dock', 'harbor', 'train station', 'railway station',
    'subway station', 'gas pump', 'gasoline pump', 'petrol pump', 'quadrangle'
  ],
  '插画·CG': [
    // 收紧到纯艺术词（v1.1.0）：comic book/书本封面/拼图移到「截图」
    'comic', 'manga', 'cartoon', 'drawing', 'sketch', 'illustration', 'poster',
    'painting', 'art', 'canvas', 'sculpture', 'statue', 'bust'
  ],
  '物品·道具': [
    // 武器
    'revolver', 'rifle', 'assault rifle', 'shotgun', 'machine gun', 'carbine', 'cannon', 'tank',
    'projectile', 'missile', 'rocket', 'bow', 'crossbow', 'saber', 'scabbard', 'cleaver', 'axe',
    'hatchet', 'halberd', 'mace', 'lance', 'spear', 'rapier', 'dagger', 'stiletto', 'broadsword',
    // 乐器
    'guitar', 'electric guitar', 'banjo', 'cello', 'violin', 'harp', 'grand piano', 'upright piano',
    'acoustic guitar', 'steel drum', 'maraca', 'steel-string', 'trombone', 'French horn', 'cornet',
    'oboe', 'sax', 'saxophone', 'harmonica', 'flute', 'organ', 'steel pan', 'clavichord',
    // 车辆 / 载具
    'car', 'sports car', 'convertible', 'limousine', 'jeep', 'land rover', 'minivan', 'beach wagon',
    'taxi', 'truck', 'moving van', 'tow truck', 'garbage truck', 'forklift', 'crane',
    'trailer truck', 'tractor', 'streetcar', 'trolley', 'trolley bus', 'fire engine', 'police van',
    'ambulance', 'snowplow', 'amphibian', 'amphibious vehicle', 'boat', 'canoe', 'kayak', 'dinghy',
    'speedboat', 'catamaran', 'trimaran', 'fireboat', 'gondola', 'sailboat', 'sailing ship',
    'schooner', 'yacht', 'lifeboat', 'ship', 'airliner', 'warplane', 'drone', 'airplane',
    'airship', 'balloon', 'parachute', 'hang glider', 'spacecraft', 'scooter', 'moped',
    'motor scooter', 'motorcycle', 'motorbike', 'minibike', 'bicycle', 'mountain bike',
    'tricycle', 'unicycle', 'rickshaw', 'oxcart', 'horse cart', 'carriage', 'wheelchair',
    // 家具 / 容器 / 包（clock/typewriter/printer 已移到「截图」）
    'table lamp', 'lampshade', 'candle', 'torch', 'lighter', 'matchstick', 'hourglass',
    'abacus', 'mailbox', 'postbox', 'filing cabinet', 'safe', 'chest', 'coffin', 'carton',
    'packet', 'plastic bag', 'grocery bag', 'purse', 'handbag', 'briefcase', 'shopping cart',
    'shopping basket', 'bathtub', 'washbasin', 'sink', 'toilet seat', 'barber chair', 'desk',
    'bookcase', 'wardrobe', 'china cabinet', 'file cabinet', 'rocking chair', 'sofa', 'couch',
    'lounge', 'daybed', 'four-poster',
    // 运动器材
    'basketball', 'rugby ball', 'soccer ball', 'baseball', 'volleyball', 'croquet ball',
    'golf ball', 'ping-pong ball', 'billiard ball', 'racket', 'snowshoe', 'skateboard', 'surfboard',
    // 厨具 / 容器
    'caldron', 'cauldron', 'frying pan', 'wok', 'crockpot', 'spatula', 'ladle', 'strainer',
    'whisk', 'cocktail shaker', 'water jug', 'pitcher'
  ]
};

/* 匹配优先级（v1.1.0）：
 * 截图 > 动物 > 美食 > 角色图 > 风景图 > 插画·CG > 物品·道具
 * - 截图最优先：屏幕/UI 词极明确，抽卡/学习截图优先归位
 * - 角色图在风景图前：立绘背景的 beach/cliff 不该压过人物服饰词
 * - 物品·道具最后：减少动漫角色/场景被误判为实物 */
const ORDER = ['截图', '动物·萌宠', '美食', '角色图', '风景图', '插画·CG', '物品·道具'];

function buildMatchers() {
  const m = {};
  for (const [cat, words] of Object.entries(KW)) {
    m[cat] = words.map(w => {
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(^|[^a-z])' + esc.toLowerCase() + '([^a-z]|$)', 'i');
    });
  }
  return m;
}
const MATCHERS = buildMatchers();

function mapCategory(top) {
  for (const cat of ORDER) {
    for (const t of top) {
      for (const re of MATCHERS[cat]) {
        if (re.test(t.label)) return { category: cat, hit: t.label, prob: t.prob };
      }
    }
  }
  // 无关键词命中：MobileNetV2 对二次元/截图语义理解弱，
  // 看不清的图宁可归「其他」也不要乱猜（v1.1.0 改：不再赌「角色图」）。
  // 用户可在详情面板手动纠正分类。
  return { category: '其他', hit: top[0] ? top[0].label : '', prob: top[0] ? top[0].prob : 0 };
}

/* ---------- 初始化 ---------- */
async function ensure(modelDir) {
  if (session) return true;
  if (!ort) ort = require('onnxruntime-node');
  const mp = path.join(modelDir, 'mobilenetv2-12-int8.onnx');
  const lp = path.join(modelDir, 'labels.txt');
  if (!fs.existsSync(mp)) throw new Error('模型文件缺失: ' + mp);
  if (!fs.existsSync(lp)) throw new Error('标签文件缺失: ' + lp);
  if (!labels) {
    labels = fs.readFileSync(lp, 'utf8').split('\n')
      .map(s => s.trim()).filter(Boolean)
      .map(line => { const parts = line.split(','); return (parts[1] || parts[0] || '').trim(); });
  }
  session = await ort.InferenceSession.create(mp, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
  });
  return true;
}

/* ---------- 预处理：图片 → 1x3x224x224 归一化张量 ---------- */
function preprocess(nativeImage) {
  let img = nativeImage;
  if (img.isEmpty()) return null;
  const sz = img.getSize();
  if (sz.width < 8 || sz.height < 8) return null;
  img = img.resize({ width: 224, height: 224, quality: 'good' });
  const buf = img.toBitmap(); // BGRA
  const n = 224 * 224;
  const data = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    const si = i * 4, di = i;
    data[di] = (buf[si + 2] / 255 - mean[0]) / std[0];
    data[n + di] = (buf[si + 1] / 255 - mean[1]) / std[1];
    data[2 * n + di] = (buf[si] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor('float32', data, [1, 3, 224, 224]);
}

/* ---------- 分类一张图（传入 Electron nativeImage 对象） ---------- */
async function classifyImage(img) {
  if (!session) throw new Error('模型尚未初始化');
  const t = preprocess(img);
  if (!t) return null;
  const out = await session.run({ [session.inputNames[0]]: t });
  const logits = out[session.outputNames[0]].data;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) { exps[i] = Math.exp(logits[i] - max); sum += exps[i]; }
  const idx = [];
  for (let i = 0; i < exps.length; i++) idx.push([exps[i] / sum, i]);
  idx.sort((a, b) => b[0] - a[0]);
  const top = idx.slice(0, 5).map(([p, i]) => ({ label: (labels[i] || ('class' + i)).toLowerCase(), prob: p }));
  const m = mapCategory(top);
  return { category: m.category, hit: m.hit, conf: m.prob, top };
}

module.exports = { CATEGORIES, ensure, classifyImage };
