process.env.debug = 'findata:*';
import { Market, Symbol } from './types';
import { Kdb, Hesonogoma } from './api';
import { Store as db } from 'ns-store';
import { tryCatch } from 'ns-common';
import { filter } from 'lodash';
import { Model, Sequelize } from 'sequelize-typescript';
import * as moment from 'moment';

const debug = require('debug')('findata:main');
const config = require('../../config/config');

/**
 * 财经数据实现类
 */
export class DataProvider {
  /**
  * 获取市场数据
  */
  @tryCatch('获取市场数据')
  async getMarkets() {
    debug('getMarkets，获取市场数据方法[启动]');
    // 交易股票列表取得
    const symbolList: Symbol[] = await this.getSymbolList();

    // filter(symbolList, { 'exchange': exchange.code });
    const markets: Market[] = [];
    // 交易所
    for (const exchange of db.data.ExchangeList) {
      // 交易市场
      const market = <Market>{
        name: exchange.name,
        submarkets: []
      };
      const marketList = filter(db.data.MarketList, { 'exchange': exchange.code });
      for (const ml of marketList) {
        market.submarkets.push({
          name: ml.name,
          // 交易股票
          symbols: filter(symbolList, { 'exchange': exchange.name, 'market': ml.name })
        });
      }
      markets.push(market);
    }

    debug('getMarkets，获取市场数据方法[终了]');
    return markets;
  }

  /**
  * 获取股票列表
  */
  @tryCatch('获取股票列表')
  async getSymbolList(): Promise<Symbol[]> {
    debug('getSymbolList，获取股票列表方法[启动]');
    const hesonogoma = new Hesonogoma();
    const count = await db.model.SymbolInfo.count();
    debug('SymbolInfo表数据个数: ', count);
    // 数据库未找到股票信息
    if (count === 0) {
      // 通过api取数据
      const symbols = await hesonogoma.getTseStocks();
      debug('数据库未找到股票信息,通过api获取数据个数: ', symbols.length);
      if (symbols && symbols.length !== 0) {
        await db.model.SymbolInfo.bulkCreate(symbols);
      }
    }
    const symbolList = await db.model.SymbolInfo.findAll({
      // raw: true,
      attributes: ['symbol', 'exchange', 'market', 'name', 'type', 'sector'],
      include: [
        {
          model: db.model.Exchange,
          attributes: ['name']
        },
        {
          model: db.model.Market,
          attributes: ['name'],
          where: { exchange: 'TSE' }
        },
        {
          model: db.model.Sector,
          attributes: ['name'],
          where: { exchange: 'TSE' }
        }
      ],
      order: Sequelize.col('symbol')
    });
    const plainSymbolList: Symbol[] = symbolList.map((node: Model<{}>) => {
      const plainNode = node.get({ plain: true });
      return {
        symbol: plainNode.symbol,
        exchange: plainNode.ex.name,
        market: plainNode.ma.name,
        name: plainNode.name,
        type: plainNode.type,
        sector: plainNode.se.name
      };
    });
    debug('取得数据个数：', plainSymbolList.length);
    debug('getSymbolList，获取股票列表方法[终了]');
    return plainSymbolList;
  }

  /**
   * 获取最近20分钟的K线数据
   * 按最近30分钟为范围，查找5分钟K线
   */
  async getLast20minBar(symbol: string) {
    return await db.sequelize.query(`
      SELECT
        t2.time,t2.open,t2.high,t2.low,t1.text close
      FROM
        dde t1
      JOIN (
        SELECT
          CONCAT(UNIX_TIMESTAMP(DATE_FORMAT(
            FLOOR(
              STR_TO_DATE(created_at, '%Y-%m-%d %T') / 500
            ) * 500,
            '%Y-%m-%d %h:%i:%s'
          )),'000') time,  text open,max(text) high, min(text) low, MAX(created_at) last_time
        FROM
          dde
        WHERE
          item = '現在値'
          AND topic = '${symbol}'
          AND created_at LIKE '${moment().format('YYYY-MM-DD')}%'
          AND (
            STR_TO_DATE(created_at, '%Y-%m-%d %T') BETWEEN DATE_SUB(now(), INTERVAL 30 MINUTE)
            AND now()
          )
        GROUP BY
          DATE_FORMAT(
            FLOOR(
              STR_TO_DATE(created_at, '%Y-%m-%d %T') / 500
            ) * 500,
            '%H%i'
          )
      ORDER BY
        created_at DESC
      ) t2 on t1.created_at = t2.last_time
    ` , { type: db.sequelize.QueryTypes.SELECT });
  }
}

export { Kdb, Hesonogoma };
