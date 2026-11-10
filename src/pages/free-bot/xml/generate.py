#!/usr/bin/env python3
"""Builds Kapa's 4 Free Bots as Bot Builder XML: python3 src/pages/free-bot/xml/generate.py

Each bot keeps the reference bot's name, market, entry rule and settings fields (same labels), and adds Kapa's
guard: the bot counts its own profit (one Run = one session), the stop-loss is enforced before every trade and
capped at 25% of the balance, no stake goes above Max Stake or past the room left before the stop-loss, and the
martingale level is cut to the losing run whose stakes fit under the stop-loss together.
qa/real/freebots-bt.mjs replays exactly these rules on 300,000 real ticks: change both together.
"""
import os
from xml.sax.saxutils import escape

OUT = os.path.dirname(os.path.abspath(__file__))


class Bot:
    def __init__(self, tag):
        self.tag, self.n, self.vars = tag, 0, {}

    def uid(self):
        self.n += 1
        return f'{self.tag}{self.n:03d}'

    def vid(self, name):
        if name not in self.vars:
            self.vars[name] = f'{self.tag}v{len(self.vars):03d}'
        return self.vars[name]

    # ---- value blocks (return XML strings) ----
    def blk(self, typ, inner='', attrs=''):
        return f'<block type="{typ}" id="{self.uid()}"{attrs}>{inner}</block>'

    def num(self, x):
        return self.blk('math_number', f'<field name="NUM">{x}</field>')

    def txt(self, s):
        return self.blk('text', f'<field name="TEXT">{escape(s)}</field>')

    def get(self, name):
        return self.blk('variables_get', f'<field name="VAR" id="{self.vid(name)}">{escape(name)}</field>')

    def val(self, name, x):
        if isinstance(x, (int, float)):
            x = self.num(x)
        return f'<value name="{name}">{x}</value>'

    def tval(self, name, x):  # text input with its empty text shadow, as Bot Builder saves it
        return f'<value name="{name}"><shadow type="text"><field name="TEXT"></field></shadow>{x}</value>'

    def ar(self, op, a, b):  # ADD MINUS MULTIPLY DIVIDE
        return self.blk('math_arithmetic', f'<field name="OP">{op}</field>' + self.val('A', a) + self.val('B', b))

    def cmp(self, op, a, b):  # EQ NEQ LT LTE GT GTE
        return self.blk('logic_compare', f'<field name="OP">{op}</field>' + self.val('A', a) + self.val('B', b))

    def AND(self, a, b):
        return self.blk('logic_operation', '<field name="OP">AND</field>' + self.val('A', a) + self.val('B', b))

    def OR(self, a, b):
        return self.blk('logic_operation', '<field name="OP">OR</field>' + self.val('A', a) + self.val('B', b))

    def bool(self, b):
        return self.blk('logic_boolean', f'<field name="BOOL">{"TRUE" if b else "FALSE"}</field>')

    def single(self, op, a):  # ABS NEG
        return self.blk('math_single', f'<field name="OP">{op}</field>' + self.val('NUM', a))

    def rnd(self, op, a):  # ROUND ROUNDUP ROUNDDOWN
        return self.blk('math_round', f'<field name="OP">{op}</field>' + self.val('NUM', a))

    def cents(self, a, op='ROUND'):
        return self.ar('DIVIDE', self.rnd(op, self.ar('MULTIPLY', a, 100)), 100)

    def prop(self, p, a):  # EVEN ODD NEGATIVE
        return self.blk('math_number_property', f'<mutation divisor_input="false"></mutation><field name="PROPERTY">{p}</field>' + self.val('NUMBER_TO_CHECK', a))

    def tern(self, c, a, b):
        return self.blk('logic_ternary', self.val('IF', c) + self.val('THEN', a) + self.val('ELSE', b))

    def result(self, r):
        return self.blk('contract_check_result', f'<field name="CHECK_RESULT">{r}</field>')

    def detail(self, i=4):
        return self.blk('read_details', f'<field name="DETAIL_INDEX">{i}</field>')

    def last_digit(self):
        return self.blk('last_digit')

    def digit_list(self):
        return self.blk('lastDigitList')

    def balance(self):
        return self.blk('balance', '<field name="BALANCE_TYPE">NUM</field>')

    def at_end(self, lst, i):
        return self.blk('lists_getIndex', '<mutation statement="false" at="true"></mutation><field name="MODE">GET</field><field name="WHERE">FROM_END</field>' + self.val('VALUE', lst) + self.val('AT', i))

    def length(self, lst):
        return self.blk('lists_length', self.val('VALUE', lst))

    def call_ret(self, name, args=()):
        m = ''.join(f'<arg name="{escape(a)}"></arg>' for a, _ in args)
        v = ''.join(self.val(f'ARG{i}', x) for i, (_, x) in enumerate(args))
        return self.blk('procedures_callreturn', f'<mutation name="{escape(name)}">{m}</mutation>' + v)

    # ---- statements (return lists of XML strings; chain() links them with <next>) ----
    def chain(self, stmts):
        out = ''
        for s in reversed([s for s in stmts if s]):
            out = s[:-len('</block>')] + (f'<next>{out}</next>' if out else '') + '</block>'
        return out

    def st(self, name, stmts):
        return f'<statement name="{name}">{self.chain(stmts)}</statement>' if stmts else ''

    def set(self, name, x):
        return self.blk('variables_set', f'<field name="VAR" id="{self.vid(name)}">{escape(name)}</field>' + self.val('VALUE', x))

    def inc(self, name, d=1):
        return self.blk('math_change', f'<field name="VAR" id="{self.vid(name)}">{escape(name)}</field>' + self.val('DELTA', d))

    def IF(self, *branches, els=None):
        n = len(branches)
        mut = f'<mutation{f" elseif={chr(34)}{n - 1}{chr(34)}" if n > 1 else ""}{" else=" + chr(34) + "1" + chr(34) if els else ""}></mutation>'
        inner = mut + ''.join(self.val(f'IF{i}', c) + self.st(f'DO{i}', s) for i, (c, s) in enumerate(branches))
        if els:
            inner += self.st('ELSE', els)
        return self.blk('controls_if', inner)

    def WHILE(self, c, stmts):
        return self.blk('controls_whileUntil', '<field name="MODE">WHILE</field>' + self.val('BOOL', c) + self.st('DO', stmts))

    def FOR(self, var, a, b, stmts):
        return self.blk('controls_for', f'<field name="VAR" id="{self.vid(var)}">{escape(var)}</field>' + self.val('FROM', a) + self.val('TO', b) + self.val('BY', 1) + self.st('DO', stmts))

    def BREAK(self):
        return self.blk('controls_flow_statements', '<field name="FLOW">BREAK</field>')

    def purchase(self, t):
        return self.blk('purchase', f'<field name="PURCHASE_LIST">{t}</field>')

    def trade_again(self):
        return self.blk('trade_again')

    def notify(self, kind, msg):
        msg = msg if msg.startswith('<block') else self.txt(msg)
        return self.blk('notify', f'<field name="NOTIFICATION_TYPE">{kind}</field><field name="NOTIFICATION_SOUND">silent</field>' + self.tval('MESSAGE', msg))

    def say(self, var, parts, kind=None):
        """text_join into var from strings and value blocks, then notify (kind) or print it"""
        items = [self.blk('text_statement', self.tval('TEXT', p if p.startswith('<block') else self.txt(p.strip()))) for p in parts]
        join = self.blk('text_join', f'<field name="VARIABLE" id="{self.vid(var)}">{escape(var)}</field>' + self.st('STACK', items))
        out = self.blk('text_print', self.tval('TEXT', self.get(var))) if kind is None else self.notify(kind, self.get(var))
        return [join, out]

    def call(self, name, args):
        m = ''.join(f'<arg name="{escape(a)}"></arg>' for a, _ in args)
        v = ''.join(self.val(f'ARG{i}', x) for i, (_, x) in enumerate(args))
        return self.blk('procedures_callnoreturn', f'<mutation name="{escape(name)}">{m}</mutation>' + v)

    # ---- top-level blocks ----
    def define(self, name, args, stmts, ret=None, x=0, y=0, collapsed=False, comment=''):
        m = ''.join(f'<arg name="{escape(a)}" varid="{self.vid(a)}"></arg>' for a in args)
        c = f'<comment pinned="false" h="120" w="320">{escape(comment)}</comment>' if comment else ''
        inner = f'<mutation>{m}</mutation><field name="NAME">{escape(name)}</field>{c}' + self.st('STACK', stmts)
        if ret is not None:
            inner += self.val('RETURN', ret)
        typ = 'procedures_defreturn' if ret is not None else 'procedures_defnoreturn'
        return self.blk(typ, inner, f' x="{x}" y="{y}"' + (' collapsed="true"' if collapsed else ''))

    def trade_definition(self, symbol, tradetype, init, submarket):
        opts = self.chain([
            self.blk('trade_definition_market', f'<field name="MARKET_LIST">synthetic_index</field><field name="SUBMARKET_LIST">random_index</field><field name="SYMBOL_LIST">{symbol}</field>', ' deletable="false" movable="false"'),
            self.blk('trade_definition_tradetype', f'<field name="TRADETYPECAT_LIST">digits</field><field name="TRADETYPE_LIST">{tradetype}</field>', ' deletable="false" movable="false"'),
            self.blk('trade_definition_contracttype', '<field name="TYPE_LIST">both</field>', ' deletable="false" movable="false"'),
            self.blk('trade_definition_candleinterval', '<field name="CANDLEINTERVAL_LIST">60</field>', ' deletable="false" movable="false"'),
            self.blk('trade_definition_restartbuysell', '<field name="TIME_MACHINE_ENABLED">FALSE</field>', ' deletable="false" movable="false"'),
            self.blk('trade_definition_restartonerror', '<field name="RESTARTONERROR">TRUE</field>', ' deletable="false" movable="false"'),
        ])
        return self.blk('trade_definition', f'<statement name="TRADE_OPTIONS">{opts}</statement>' + self.st('INITIALIZATION', init) + self.st('SUBMARKET', submarket), ' deletable="false" x="0" y="0"')

    def tradeoptions(self, amount, prediction=None):
        has = 'true' if prediction is not None else 'false'
        inner = f'<mutation has_first_barrier="false" has_second_barrier="false" has_prediction="{has}"></mutation><field name="DURATIONTYPE_LIST">t</field>'
        inner += '<value name="DURATION"><shadow type="math_number"><field name="NUM">1</field></shadow></value>'
        inner += f'<value name="AMOUNT"><shadow type="math_number"><field name="NUM">1</field></shadow>{amount}</value>'
        if prediction is not None:
            inner += f'<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">1</field></shadow>{prediction}</value>'
        return self.blk('trade_definition_tradeoptions', inner)

    def top(self, typ, stack, stmts, x, y, extra=''):
        return self.blk(typ, self.st(stack, stmts), f' x="{x}" y="{y}"{extra}')

    def xml(self, blocks):
        vs = ''.join(f'<variable id="{i}">{escape(n)}</variable>' for n, i in self.vars.items())
        return f'<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false"><variables>{vs}</variables>{"".join(blocks)}</xml>\n'


# ---------------- Kapa guard, shared by the 4 bots ----------------

def limits(b, name):
    """Stop-loss at most 25% of the balance; Max Stake between the first stake and the stop-loss."""
    g = b.get
    return [
        b.set('FirstStake', b.tern(b.cmp('LT', b.single('ABS', g('FirstStake')), 0.35), 0.35, b.cents(b.single('ABS', g('FirstStake')), 'ROUNDDOWN'))),
        b.set('Stake', g('FirstStake')),
        b.set('TargetProfit', b.single('ABS', g('TargetProfit'))),
        b.set('Stoploss', b.single('ABS', g('Stoploss'))),
        b.set('Balance Now', b.ar('MULTIPLY', b.balance(), 1)),
        b.IF((b.AND(b.cmp('GT', g('Balance Now'), 0), b.cmp('GT', g('Stoploss'), b.ar('MULTIPLY', g('Balance Now'), 0.25))), [
            b.set('Stoploss', b.cents(b.ar('MULTIPLY', g('Balance Now'), 0.25), 'ROUNDDOWN')),
            *b.say('text', ['Stop Loss lowered to', g('Stoploss'), '· at most 25% of your balance per session.'], 'warn'),
        ])),
        b.IF((b.cmp('LT', g('Stoploss'), g('FirstStake')), [b.set('Stoploss', g('FirstStake'))])),
        b.set('MaxStake', b.single('ABS', g('MaxStake'))),
        b.IF((b.cmp('GT', g('MaxStake'), g('Stoploss')), [b.set('MaxStake', g('Stoploss'))])),
        b.IF((b.cmp('LT', g('MaxStake'), g('FirstStake')), [b.set('MaxStake', g('FirstStake'))])),
        b.set('Session Profit', 0),
    ]


def guard(b, reset_cycle, done_ok):
    """After a trade: stop at the take-profit or the stop-loss; a next stake above Max Stake or past the room left
    before the stop-loss is not placed: the recovery stops and the bot goes back to the first stake if it fits."""
    g = b.get
    return [
        b.set('Stake', b.cents(g('Stake'))),
        b.IF((b.cmp('LT', g('Stake'), 0.35), [b.set('Stake', 0.35)])),
        b.set('Room', b.cents(b.ar('ADD', g('Stoploss'), g('Session Profit')))),
        b.set('Continue', b.bool(False)),
        b.IF(
            (b.cmp('GTE', g('Session Profit'), g('TargetProfit')), b.say('text2', ['Take-profit reached, profit', g('Session Profit'), '· press Run for a new session.'])),
            (b.cmp('LT', g('Room'), 0.35), b.say('text3', ['Stop-loss reached, result', g('Session Profit'), '· the bot stopped.'])),
            els=[
                b.IF((b.OR(b.cmp('GT', g('Stake'), g('MaxStake')), b.cmp('GT', g('Stake'), g('Room'))), [
                    *b.say('text4', ['Next stake ', g('Stake'), ' would pass Max Stake or the stop-loss: recovery stopped, back to the first stake.'], 'warn'),
                    *reset_cycle,
                    b.set('Stake', g('FirstStake')),
                ])),
                b.IF((b.cmp('GT', g('Stake'), g('Room')), b.say('text3', ['Stop-loss reached: the first stake no longer fits, result', g('Session Profit'), '· the bot stopped.'])),
                     els=[*done_ok, b.set('Continue', b.bool(True))]),
            ],
        ),
    ]


def status(b):
    g = b.get
    return b.IF((b.cmp('GT', g('Session Profit'), 0), b.say('text5', ['Profit ', g('Session Profit'), ' · next stake ', g('Stake'), ' · room before stop-loss ', g('Room')], 'success')),
                els=b.say('text5', ['Loss ', g('Session Profit'), ' · next stake ', g('Stake'), ' · room before stop-loss ', g('Room')], 'error'))


# ---------------- Digit Switcher Bot and GOLD PREMIUM ODD AND EVEN: martingale settings block ----------------

MM_ARGS = ['Target Profit', 'Stop Loss', 'First Stake', 'Martingale Factor', 'Martingale Level', 'Do Martingale After', 'Max Stake']


def martingale_procs(b, title):
    g = b.get
    settings = [
        b.set('TargetProfit', g('Target Profit')), b.set('Stoploss', g('Stop Loss')), b.set('FirstStake', g('First Stake')),
        b.set('MaxStake', g('Max Stake')),
        *limits(b, title),
        b.set('MartiFactor', b.single('ABS', g('Martingale Factor'))),
        b.set('MartiStart', g('Do Martingale After')),
        # the longest losing run whose stakes, added up, fit under the stop-loss, none above Max Stake
        b.set('MartiLossLevel', 0), b.set('Fit Stake', g('FirstStake')), b.set('Fit Total', g('FirstStake')),
        b.IF((b.cmp('GT', g('MartiStart'), 0), [
            b.WHILE(b.cmp('LT', g('MartiLossLevel'), g('Martingale Level')), [
                b.set('Fit Next', b.tern(b.cmp('GTE', b.ar('ADD', g('MartiLossLevel'), 1), g('MartiStart')),
                                         b.cents(b.ar('ADD', g('Fit Stake'), b.ar('MULTIPLY', g('Fit Stake'), g('MartiFactor')))), g('Fit Stake'))),
                b.IF((b.OR(b.cmp('GT', b.ar('ADD', g('Fit Total'), g('Fit Next')), g('Stoploss')), b.cmp('GT', g('Fit Next'), g('MaxStake'))), [b.BREAK()])),
                b.set('Fit Total', b.cents(b.ar('ADD', g('Fit Total'), g('Fit Next')))),
                b.set('Fit Stake', g('Fit Next')),
                b.inc('MartiLossLevel', 1),
            ]),
        ])),
        b.set('Win Count', 0), b.set('Loss Count', 0), b.set('Loss Level', 0),
        *b.say('text', [f'{title} started · take-profit ', g('TargetProfit'), ' · stop-loss ', g('Stoploss'), ' · first stake ', g('FirstStake'),
                        ' · recovery up to ', g('MartiLossLevel'), 'losses in a row · their stakes add up to', g('Fit Total'), '· inside the stop-loss'], 'info'),
    ]
    trade_again = [
        b.set('Session Profit', b.cents(b.ar('ADD', g('Session Profit'), g('Detail Profit')))),
        b.IF((g('[Win Result]'), [b.inc('Win Count', 1), b.set('Loss Count', 0), b.set('Stake', g('FirstStake'))]),
             els=[
                 b.inc('Loss Count', 1), b.set('Win Count', 0),
                 b.IF((b.cmp('GT', g('Loss Count'), g('Loss Level')), [b.set('Loss Level', g('Loss Count'))])),
                 b.IF((b.AND(b.cmp('GT', g('MartiStart'), 0), b.cmp('GTE', g('Loss Count'), g('MartiStart'))), [
                     b.IF((b.cmp('LTE', g('Loss Count'), g('MartiLossLevel')), [b.set('Stake', b.ar('ADD', g('Stake'), b.ar('MULTIPLY', g('Stake'), g('MartiFactor'))))]),
                          els=[b.set('Stake', g('FirstStake'))]),
                 ])),
             ]),
        *guard(b, [], [status(b)]),
    ]
    return [
        b.define('Bot Settings', MM_ARGS, settings, x=0, y=900, collapsed=True,
                 comment='Kapa guard: stop-loss capped at 25% of the balance, Max Stake, and the martingale cut to the losses that fit under the stop-loss.'),
        b.define('Trade Again', ['[Win Result]', 'Detail Profit'], trade_again, ret=g('Continue'), x=0, y=960, collapsed=True,
                 comment='Counts the profit, applies the martingale and returns false when the session must stop.'),
    ]


def settings_call(b, values):
    return b.call('Bot Settings', list(zip(MM_ARGS, values)))


def after_martingale(b):
    return b.top('after_purchase', 'AFTERPURCHASE_STACK', [
        b.IF((b.call_ret('Trade Again', [('[Win Result]', b.result('win')), ('Detail Profit', b.detail(4))]), [b.trade_again()])),
    ], 900, 0)


def digit_switcher():
    b = Bot('ds')
    g = b.get
    init = [
        b.notify('info', 'Digit Switcher Bot by Kapa'),
        settings_call(b, [10, 50, 1, 1.1, 12, 2, 25]),
        b.set('prediction', 5),
    ]
    sub = [b.tradeoptions(g('Stake'), g('prediction'))]
    # same entry table as the reference: Under 5 after an even digit; from 2 losses in a row, Over 5 or Under 5
    # by the loss count and the last digit's parity
    table = [(8, 'ODD', 'DIGITUNDER'), (7, 'EVEN', 'DIGITUNDER'), (6, 'ODD', 'DIGITUNDER'), (5, 'EVEN', 'DIGITUNDER'),
             (4, 'ODD', 'DIGITOVER'), (3, 'EVEN', 'DIGITOVER'), (2, 'ODD', 'DIGITOVER'), (1, 'EVEN', 'DIGITOVER')]
    before = b.top('before_purchase', 'BEFOREPURCHASE_STACK', [
        b.IF(*[(b.AND(b.cmp('GT', g('Loss Count'), n), b.prop(par, b.last_digit())), [b.purchase(t)]) for n, par, t in table]),
        b.IF((b.prop('EVEN', b.last_digit()), [b.purchase('DIGITUNDER')])),
    ], 0, 560, ' deletable="false"')
    blocks = [b.trade_definition('1HZ100V', 'overunder', init, sub), after_martingale(b), before, *martingale_procs(b, 'Digit Switcher Bot')]
    return b.xml(blocks)


def gold_premium():
    b = Bot('gp')
    g = b.get
    init = [
        b.notify('info', 'GOLD PREMIUM ODD AND EVEN by Kapa'),
        settings_call(b, [10, 50, 1, 1.2, 10, 1, 25]),
        b.set('Stats Period (Ticks)', 5),
        b.set('Minimum % You Want', 80),
        b.set('Follow Statistic (TRUE) or Do Otherwise (FALSE)', b.bool(True)),
    ]
    sub = [b.tradeoptions(g('Stake'))]
    # Even % and Odd % of the last Stats Period digits, as the reference's "Digit System" computes them
    stats = [
        b.set('LD List', b.digit_list()),
        b.set('Even Do', 0), b.set('Odd Do', 0),
        b.FOR('LD Count', 1, g('Stats Period (Ticks)'), [
            b.IF((b.prop('EVEN', b.at_end(g('LD List'), g('LD Count'))), [b.inc('Even Do', 1)]), els=[b.inc('Odd Do', 1)]),
        ]),
        b.set('Even %', b.cents(b.ar('DIVIDE', b.ar('MULTIPLY', g('Even Do'), 100), g('Stats Period (Ticks)')))),
        b.set('Odd %', b.cents(b.ar('DIVIDE', b.ar('MULTIPLY', g('Odd Do'), 100), g('Stats Period (Ticks)')))),
    ]
    ev = b.AND(b.cmp('GTE', g('Even %'), g('Minimum % You Want')), b.prop('EVEN', b.last_digit()))
    od = b.AND(b.cmp('GTE', g('Odd %'), g('Minimum % You Want')), b.prop('ODD', b.last_digit()))
    ev2 = b.AND(b.cmp('GTE', g('Even %'), g('Minimum % You Want')), b.prop('EVEN', b.last_digit()))
    od2 = b.AND(b.cmp('GTE', g('Odd %'), g('Minimum % You Want')), b.prop('ODD', b.last_digit()))
    before = b.top('before_purchase', 'BEFOREPURCHASE_STACK', [
        *stats,
        b.IF((b.cmp('EQ', g('Follow Statistic (TRUE) or Do Otherwise (FALSE)'), b.bool(True)), [
            b.IF((ev, [b.purchase('DIGITEVEN')]), (od, [b.purchase('DIGITODD')])),
        ]), els=[
            b.IF((ev2, [b.purchase('DIGITODD')]), (od2, [b.purchase('DIGITEVEN')])),
        ]),
    ], 0, 560, ' deletable="false"')
    blocks = [b.trade_definition('R_100', 'evenodd', init, sub), after_martingale(b), before, *martingale_procs(b, 'GOLD PREMIUM ODD AND EVEN')]
    return b.xml(blocks)


def profit_maker():
    b = Bot('pm')
    g = b.get
    init = [
        b.notify('info', 'PROFIT MAKER BOT by Kapa'),
        b.set('Expected Profit', 5),
        b.set('Stop Loss', 50),
        b.set('Win Stake', 1),
        b.set('Prediction Number', 2),
        b.set('Martingale Factor ', 2.2),
        b.set('Martingale Level', 10),
        b.set('Max Stake', 25),
        b.call('Bot Settings', []),
    ]
    settings = [
        b.set('TargetProfit', g('Expected Profit')), b.set('Stoploss', g('Stop Loss')), b.set('FirstStake', g('Win Stake')),
        b.set('MaxStake', g('Max Stake')),
        *limits(b, 'PROFIT MAKER BOT'),
        # the longest losing run (lost stake × factor each time) that fits under the stop-loss and Max Stake
        b.set('MartiLossLevel', 0), b.set('Fit Stake', g('FirstStake')), b.set('Fit Total', g('FirstStake')),
        b.WHILE(b.cmp('LT', g('MartiLossLevel'), g('Martingale Level')), [
            b.set('Fit Next', b.cents(b.ar('MULTIPLY', g('Fit Stake'), b.single('ABS', g('Martingale Factor '))))),
            b.IF((b.OR(b.cmp('GT', b.ar('ADD', g('Fit Total'), g('Fit Next')), g('Stoploss')), b.cmp('GT', g('Fit Next'), g('MaxStake'))), [b.BREAK()])),
            b.set('Fit Total', b.cents(b.ar('ADD', g('Fit Total'), g('Fit Next')))),
            b.set('Fit Stake', g('Fit Next')),
            b.inc('MartiLossLevel', 1),
        ]),
        b.set('Loss', 0),
        *b.say('text', ['PROFIT MAKER BOT started · take-profit ', g('TargetProfit'), ' · stop-loss ', g('Stoploss'), ' · first stake ', g('FirstStake'),
                        ' · recovery up to ', g('MartiLossLevel'), 'losses in a row · their stakes add up to', g('Fit Total'), '· inside the stop-loss'], 'info'),
    ]
    sub = [b.tradeoptions(g('Stake'), b.tern(b.cmp('EQ', g('Loss'), 0), g('Prediction Number'), 4))]
    after = b.top('after_purchase', 'AFTERPURCHASE_STACK', [
        b.set('Session Profit', b.cents(b.ar('ADD', g('Session Profit'), b.detail(4)))),
        b.IF((b.result('win'), [b.set('Stake', g('FirstStake')), b.set('Loss', 0)]),
             els=[
                 b.inc('Loss', 1),
                 b.IF((b.cmp('LTE', g('Loss'), g('MartiLossLevel')), [b.set('Stake', b.ar('MULTIPLY', b.single('ABS', b.detail(4)), b.single('ABS', g('Martingale Factor '))))]),
                      els=[b.set('Stake', g('FirstStake'))]),
             ]),
        *guard(b, [], [status(b)]),
        b.IF((g('Continue'), [b.trade_again()])),
    ], 900, 0)
    before = b.top('before_purchase', 'BEFOREPURCHASE_STACK', [b.purchase('DIGITOVER')], 0, 560, ' deletable="false"')
    blocks = [b.trade_definition('R_100', 'overunder', init, sub), after, before,
              b.define('Bot Settings', [], settings, x=0, y=900, collapsed=True,
                       comment='Kapa guard: stop-loss capped at 25% of the balance, Max Stake, and the martingale cut to the losses that fit under the stop-loss.')]
    return b.xml(blocks)


DP_ARGS = ['1st Over Digit', '2nd Over Digit', 'Amount', 'Profit', 'Ticks to analyze', 'Mart Splits', '% Win Per Stake', 'Martingale Level', 'Stop Loss', 'Max Stake']


def dollar_printer():
    b = Bot('dp')
    g = b.get
    init = [
        b.notify('info', 'DOLLAR PRINTER BOT by Kapa'),
        b.call('Starts', list(zip(DP_ARGS, [0, 5, 1, 10, 15, 1, 80, 5, 50, 25]))),
    ]
    starts = [
        b.set('Return % Number', g('% Win Per Stake')),
        b.set('Ticks to Analyse', g('Ticks to analyze')),
        b.set('P1', g('1st Over Digit')), b.set('P2', g('2nd Over Digit')),
        b.set('S1', b.bool(True)),
        b.set('Martingale Split', b.tern(b.cmp('LT', g('Mart Splits'), 1), 1, g('Mart Splits'))),
        b.set('TargetProfit', g('Profit')), b.set('Stoploss', g('Stop Loss')), b.set('FirstStake', g('Amount')), b.set('MaxStake', g('Max Stake')),
        *limits(b, 'DOLLAR PRINTER BOT'),
        b.set('Initial Stake', g('FirstStake')),
        b.set('Total Lost', 0), b.set('Recovery Count', 0),
        # recovery trades whose stakes (Total Lost × 100 / % Win Per Stake / Mart Splits) fit, with the first one,
        # under the stop-loss and Max Stake
        b.set('Martingale Stop', 0), b.set('Fit Total', g('FirstStake')),
        b.WHILE(b.cmp('LT', g('Martingale Stop'), g('Martingale Level')), [
            b.set('Fit Next', b.cents(b.ar('DIVIDE', b.ar('MULTIPLY', g('Fit Total'), b.ar('DIVIDE', 100, g('Return % Number'))), g('Martingale Split')))),
            b.IF((b.cmp('LT', g('Fit Next'), g('FirstStake')), [b.set('Fit Next', g('FirstStake'))])),
            b.IF((b.OR(b.cmp('GT', b.ar('ADD', g('Fit Total'), g('Fit Next')), g('Stoploss')), b.cmp('GT', g('Fit Next'), g('MaxStake'))), [b.BREAK()])),
            b.set('Fit Total', b.cents(b.ar('ADD', g('Fit Total'), g('Fit Next')))),
            b.inc('Martingale Stop', 1),
        ]),
        *b.say('text', ['DOLLAR PRINTER BOT started · take-profit ', g('TargetProfit'), ' · stop-loss ', g('Stoploss'), ' · first stake ', g('FirstStake'),
                        ' · up to ', g('Martingale Stop'), 'recovery trades · their stakes add up to', g('Fit Total'), '· inside the stop-loss'], 'info'),
    ]
    sub = [
        b.set('Prediction', b.tern(g('S1'), g('P1'), g('P2'))),
        b.set('Stake', g('Initial Stake')),
        b.tradeoptions(g('Stake'), g('Prediction')),
    ]
    # Over P when at least (9 − P) × 10 % of the last "Ticks to analyze" digits are above P (90% for Over 0,
    # 40% for Over 5), checked before every trade
    before = b.top('before_purchase', 'BEFOREPURCHASE_STACK', [
        b.set('Digits analysed', b.digit_list()),
        b.set('Over Count', 0),
        b.FOR('LD Count', 1, g('Ticks to Analyse'), [
            b.IF((b.cmp('GT', b.at_end(g('Digits analysed'), g('LD Count')), g('Prediction')), [b.inc('Over Count', 1)])),
        ]),
        b.set('Over %', b.ar('DIVIDE', b.ar('MULTIPLY', g('Over Count'), 100), g('Ticks to Analyse'))),
        b.IF((b.cmp('GTE', g('Over %'), b.ar('MULTIPLY', b.ar('MINUS', 9, g('Prediction')), 10)), [b.purchase('DIGITOVER')])),
    ], 0, 560, ' deletable="false"')
    reset_cycle = [b.set('Total Lost', 0), b.set('Recovery Count', 0), b.set('S1', b.bool(True))]
    after = b.top('after_purchase', 'AFTERPURCHASE_STACK', [
        b.set('Session Profit', b.cents(b.ar('ADD', g('Session Profit'), b.detail(4)))),
        b.IF((b.result('loss'), [
            b.set('Total Lost', b.cents(b.ar('ADD', g('Total Lost'), g('Stake')))), b.set('S1', b.bool(False)), b.inc('Recovery Count', 1),
        ]), els=[
            b.set('Total Lost', b.cents(b.ar('MINUS', g('Total Lost'), b.detail(4)))),
            b.IF((b.cmp('LTE', g('Total Lost'), 0), [b.set('Total Lost', 0), b.set('S1', b.bool(True)), b.set('Recovery Count', 0)])),
        ]),
        b.set('Stake', b.tern(b.cmp('GT', g('Total Lost'), 0),
                              b.ar('DIVIDE', b.ar('MULTIPLY', g('Total Lost'), b.ar('DIVIDE', 100, g('Return % Number'))), g('Martingale Split')), g('FirstStake'))),
        b.IF((b.cmp('GT', g('Recovery Count'), g('Martingale Stop')), [
            b.notify('warn', 'Recovery limit reached: loss accepted, back to the first stake.'),
            *reset_cycle, b.set('Stake', g('FirstStake')),
        ])),
        b.IF((b.cmp('LT', g('Stake'), g('FirstStake')), [b.set('Stake', g('FirstStake'))])),
        *guard(b, reset_cycle, [status(b)]),
        b.set('Initial Stake', g('Stake')),
        b.IF((g('Continue'), [b.trade_again()])),
    ], 900, 0)
    blocks = [b.trade_definition('1HZ100V', 'overunder', init, sub), after, before,
              b.define('Starts', DP_ARGS, starts, x=0, y=900, collapsed=True,
                       comment='Kapa guard: stop-loss capped at 25% of the balance, Max Stake, and recovery trades cut to the ones that fit under the stop-loss.')]
    return b.xml(blocks)


if __name__ == '__main__':
    for fname, make in [('digit_switcher_bot.xml', digit_switcher), ('dollar_printer.xml', dollar_printer),
                        ('gold_premium_odd_and_even.xml', gold_premium), ('profit_maker_bot.xml', profit_maker)]:
        with open(os.path.join(OUT, fname), 'w') as f:
            f.write(make())
        print('wrote', fname)
