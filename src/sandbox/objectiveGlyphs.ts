import { GLYPH_H, GLYPH_W } from './glyphs';

/**
 * 基地与前哨站数字的字形样本集 —— 与机器人血量**分开**。
 *
 * 必须分开的原因：这套 UI 的字号更矮（5~6 行，血量是 7 行）。字格归一化是
 * 「按高度缩放并保宽高比」，于是同一个 "1"，在血量里是 2 宽×7 高 → 占 3 列（细长、好认），
 * 在前哨站里是 3 宽×5 高 → 占 7 列（几乎满宽，和 "0" 混）。复用血量模板会稳定地把
 * 1500 读成 500。字号变化往往还伴随字形重绘（这里的 "1" 多了个衬线），所以分开建样本
 * 比让归一化对字号不变更靠谱。
 *
 * 样本来源：这四个数字是全局的 —— 同一时刻八路画面看到的完全相同，
 * 所以人工读一次真值就能收获八路样本，再乘以阈值阶梯，16 组标注扩成 400 个字段、
 * 每个数字数百个样本。
 *
 * 编码与 glyphs.ts 相同：每格量化到 16 级写成一个十六进制字符，行优先。
 * 本文件由工具生成，不要手改。见 tools/sandbox/README.md。
 */

const RAW: Record<string, string[]> = {
  "0": [
    'eeffffffeeffffffff2200ffff2200ffff0000ffff0000ffff0000ffff0000ffff8811ffff8811ff22ffff8822ffff88',
    '5bda9dd98cb65adccd9106bfee80027fee80028fee80017fee80017fee80017fee80027fde90049f8cc99acd5cffffec',
    'ffffffccffffffccff0055ffff0055ffff1122ffff1122ffff0011ffff0011ffff33ffffff33ffffaaffff66aaffff66',
    '8dedadeccec75adeefa216bfef9004afef9004afef9004afef90049fdea005afdfa108ef7deddeed38bdfca8015ce820',
    'bdeeee61ddcbbd61ec5248a4eb2127b7c82127b7c82127b6b71127b5a61016b5da217c82db549c82aabccd6189cddb40',
    '06ffff6006ffff60bcf33defbcf33defcdf329dfcdf329dfcde329cfcde329cf59f33fed59f33fed06eeef7106eeef61',
    'bedabeb3dda57cc8fb603bedf6100afff6100afff6100afff6100aeff61009eff72009eefb733bebccbaacb69bdeec82',
    '11ffffaa11ffffaaff0000ffff0000ffff0000ffff0000ffff0000ffff0000ffff2200ffff2200ff00ffee2200ffee22',
  ],
  "1": [
    '6fffd9906ccdda903479ccc00136dee00034bee000009ee000009ee000019ee00001aee10011aff10012bff10012bff1',
    '5ffffff05ffffff0224ffff0003ffff0003eeff0003deff0003ffff0003ffff0003eeff0003eeff000345ff000345ff0',
    '0ffffff00ffffff0000ffff0000ffff0000ffff0000ffff0000ffee0000ffee0000ffff0000ffff0000ffdd0000ffdd0',
    '0dfc99302ee968423fd735325fd722005ffb77305feb79434ed857454ed633254ed624351de856550cda66430aca6520',
    '7dffedb07dffedb0338fd980007fc760007fc440007fc330007fc320007fc210007fb110007fb110007fb110007fb110',
    '013ff000002ff000001ef000000ee000000ee000000de000000dd000000de000000de000001ef000001ef000001ef000',
    '0ffda9000acdba00047ded00036dfe00025dff00014cff00014cff00014cff00014cfe00014cee00014cfe00014cfe00',
    '0cfedd00079acd000125bd0000008d0000008e0000009e0000009e0000009e0000009e0000019e000001af000001af00',
  ],
  "2": [
    '06ffffa87af988abeef3019f0000009f000017cf00003eff06efff607ae98830eff30000f9000000fc888888efffffff',
    '6cfffd80cdb5bdc1a9607be2000007f40013dfe106abea505beaa500ffb00000f6100000fcaaaaa1cdeddcb17aba8640',
    '9ca00ab369700ac600000aff00008dc70000efa107bdf72019cdd5009da00000bb700000f8300000fdbbbb83ffffffc5',
    '7affff60aa889da7e9202cef0000019f000028ce00014fed06efe94079c97420eda20000f9100000fc888877fffffffe',
    'cff639e9aaa427eb610004ff41004be530127fc0009deb1003cca70008d600000ad600000dd733330cedccba0aeffffc',
    'ffb46cd988623bec00000aff0000ffc60588fa630afff500ffb20000fe910000fc800000ffffffed8accadc705896b90',
    '5bffffb3bdd77a95fea11575fa500578fc966996ecbaaca679bbbeda13454bee211108ef66666ac978accb94459ff953',
    '0affffa11aed5cda179807cf0000027f0000deff014aefc5049faa701afe0000dea00000efdaaaaaacefeedb08cebda2',
  ],
  "3": [
    '0affffa0adc55cdaaa7008df0000038f0000ffff003affff003aacef000007cf000008df17aaaded17cffc98005ef500',
    'fffff900f955dda0a4008cf0000006f00028eff006bdfed006aabcd0000027f000006bf0aaaacb90abdfb840049e3000',
    'defffe60ec889fa8f9003fff0000009f000028be00003fdc06eeff60037778880000009f0000009f88888888ffffff61',
    'f9002cefb60029cf0000009f000459cf00069fff013cefff013bddef0000009f0000009f0000009fbbbbbbdfffffffff',
    '0000dea00012efa00013ffa0005fffa006bf6ca00aed0aa01aa11aa19dc59dd9ffc7ffffcddddeed66666cc600000aa0',
    'deffff70ec889fb8fa103eff0000008f000357cf00059fff05efffff037888cf0000019f000017cf77888ba8deffff72',
    '0affffa0add95cdaaa840aff000009ef004dffff005effff003aadff00000aff02200aff9abaadff9acffdca005ffa50',
    'fb613fff863117cf0000009f012cffff038effff06efffff0000019f3200009f6400009fffffffff79ceeb98039ed730',
  ],
  "4": [
    'bcdbcba5bbb899858742656465236674668bdb74569bdc952346abc7221268b7651267c87756aac889adda7358aee932',
    '0000cea00001dfa00002ffa0006fffa005ae8da009fe0aa01a900aa08cb48dc7ffc9fffedeffffff77888dd800001aa1',
    '0000bec50014dfc7004cffec04afaded08de4bec08db1ada2ad92adaeeeddfffdeffffffadffffff45555cff00001aee',
    '003dff80014eff80029fff8016cc9e8029fa5d80cc726e80ed727e92ffeffffeeeeffffeeefffffe44448ea400005d80',
    '314dffa1116effa1027fffa00aff6cb15cd85ca1aeb14ca1ffffffffefffffffeffffffe00006cb100004ba100001a90',
    '0002dfc10015dfb1002bffb0004fefb00bfc1bb02cc41bb05dc55cc4cffddffcbeeeeffb37767dc400000bb000000bb0',
    '0013efeb0039ffed005efffe06bf9dfe0aed2beb3bd90ad8deecbeedefffffffceffffff22223bed00000ac700000aa0',
    '0013ffa00026ffa0005fffa005ae6ca009dd0aa03bb30aa06cb32bb2ffebffedbdddfffe6adfffff23444bc500000ab2',
  ],
  "5": [
    'ffffff66ffffff66ff000000ff000000ffffff00ffffff00000011ff000011ff110000ff110000ff00ffff0000ffff00',
    'beffefff8dedabba7cd85775ada000019deddd914bfeeec928aaabdf111116af9b9108df7cd99dff38bdecba026ce732',
    '7999ffb28998de9289a8993179baa911acfffe317dffffa165668cc3dd759ee5ffbadfe5bbdeedb5338ac933a5546633',
    'deeeefdbdc987876eb410111ea300001ec977731eeeeed6135657ded233238ce1000029e431015bf88888adeceffffec',
    'ffe64630fc832310ea310000efffff71cddeefb8bbbddfff000002af641016bfc82029dfefffffff8aceec9715aee940',
    'fc710100fb510000fa100000fd988840ffffff6044557eed12335cef0000019f210001af420002afbbbbbbdeeffffffe',
    'ffffffbbffffffbbff660000ff660000ffffff22ffffff220000ddff0000ddffbb00eeffbb00eeffddffff11ddffff11',
    'cfffffe6dec78983dea01221dd900000dffffc706cedfeb326878dd6000009e943102bf99a989dd48abeec90036cc630',
  ],
  "6": [
    '8deb0affadc61588dea010009dffffa09dff8cc88dfe0aff8da0005f7ca0005f6ca0005f0affffff0588fa880001f500',
    'ffffffffefd8d988efb2c400efffffb3deff8cd9ceff0affcea0005fdea0005fffa0016fceffffff67aefda8005efa50',
    'adff0affbec84688cea08300ffffffa0deff8cc8beff0affdea0005fefa0005fffa0005f6cffffff36aefda8004dea60',
    '6cc60aff8dc507bbdea01000bed99960adffffa07cfe2aed6cec08df6ca0005f7ca0005f8da0005f5cebbbcf4bffffff',
    '0affffa08cc67cc5dea018a6fb600000eedccc80efeb9cc7eea209ddec8006beed8007cfcca66acb7abccb96259ee951',
    '8effff884788ae7611126d6400005d500000ae500000ce400001ca000025ca000038a900014858000367580005755800',
    'fa102ceff91029aaf9000000fc999930ffffff60fda449bdfc8217cff900009ff900009ff900009ffdbbbbdfffffffff',
    'eeca2cfffea53788fd804100ffffff91effd8dc8dffc1affed80006ffd80006ffd80006fefffffff778af9880016e400',
  ],
  "7": [
    'a98bcffe665bdfc9000bef70000bff70001cec60024cd210049dc00027fda0008bf84000eff30000fec30000fda20000',
    'eecaeffba864ced53210ceb00000efb00013ea50003af600004ee600027f930009ef20000afe10001ad800001ab20000',
    'ffffffff88888bef111106cf00001add00003ca700006e800005df700018d940002bd200038ed20005bb710007e81000',
    '0affffa09dc66cd9cc800afe00000aff0000ceda0466ec8239dec510bdc83100dea00000ffc66666deecbca78cefefb3',
    '01012cf100013cf100025de00005acc00008fcb00018f5200129e40004edc30025eb720047f70000ccc60000feb50000',
    '2affffa1adc67bb7fd9018b9f72008cbe95229cbda877cdbaaabadec43484bee431009ef98777cc779bccb83049ee831',
    'bfdcdebb6778aeb800137fa500127f7000038e500004ad200019d800003bc600005cb40002ab840002a8640002a53400',
    'ffffffff88877cfe22111aec00000aa10000bea00000fc700013f500004bf500005f9300038f000007cd00000ad80000',
  ],
  "8": [
    '06ffff6088888888f910009ff900009ff90014bff90028cffffffffffc8888cff900009ff900009ffc8888cfffffffff',
    'ffffffff988888cf320002af00002cef00003da800003f60000bef60000bd830000cc21004aec00005ca700006f63000',
    'fffff900fc95dda0f9408cf0f60006f0ffc0cff0ffeaeff0fcaaacf0f60006f0f60006f0fcaaacf0aabfbaa0003f3000',
    'fffffff8b976ded37420dec00000efc00000e8100028f700004fe600004fc50007df51000afd10000ae900000ac30000',
    '28ffff9579ba79aadb6302affa20008fbc9559dfbef77fffbefeeeefbc8666afda20008fc93222afbb8999cebbdfffeb',
    'defffff0efd5dff0fc808cf0f60006f0ffd7dff0ffeceff0fcaaacf0f60006f0f60006f0fcaaacf0adffeda009ffd800',
    '09fff900a97579a0f82028f0f60006f0feb0cff0ffeaeff0fcaaacf0f60006f0f60006f0fcaaacf0aabfcba0003e6300',
    '8cfffff0dca59cf0fa5049f0f60006f0ffc0cff0ffeaeff0fcaaacf0f60006f0f60006f0fcaaacf0abcfeda0025fd800',
  ],
  "9": [
    '8df99dfcaeb649fdce6205ee9e6026de3db9acfe0cffffff029cb9ee079645de1d9203de0cfeeed306bded82006bdc20',
    '3affffa48bb88ab9dc8106bdfa20029ffa3003affa3004bfadddddee677778cf220103bf331003ae678889cc8cffffda',
    '1bffffb28dd77ceacfa218efdf8005bfef9009ff7ddaadff28bdceff004a6cff065119ef09b99cec08cefca7016df710',
    'ffa06cc6fa503bdaf5000afff8300afffc988cffffffffff015e7cff62373bffc4000affffffffa088affa50016ef500',
    'eea018a4ea5008c9f60008eff60008dcfa888cdcffffffeb001318b5101218b7110008c9deffffb367adca61014ba510',
    '3bffffa0bec58dd8fc703bedf5000afffa500afffdcaadffabceceff026c6cff52000afebaaaadc59acffc70026ee500',
    '8cfffea0cec6adc0fc805bd1f60008e4f7313ae4fa767ce3dbaaadd274344ae3a40008e3b9888cd28acdcca116afb830',
    'fd910499fb7104aaf70004bef70004bdf70004bcddddddecbcddddec000104ab000104ab000004ab79bbbcc9acffffd9',
  ],
};

export const OBJECTIVE_EXEMPLARS: Record<string, Float32Array[]> = Object.fromEntries(
  Object.entries(RAW).map(([char, encoded]) => [
    char,
    encoded.map((s) => Float32Array.from({ length: GLYPH_W * GLYPH_H }, (_, i) => parseInt(s[i], 16) / 15)),
  ]),
);
